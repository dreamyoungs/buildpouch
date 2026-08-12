/**
 * 검증된 allowlist entry를 실제 파일 목록과 archive target으로 변환한다.
 *
 * 호출 관계:
 * - 진입: `inspect`, `pack` 명령
 * - 입력: `src/config/load.ts`가 반환한 설정
 *
 * 데이터·부수효과:
 * - source tree의 metadata만 읽고 파일을 복사하거나 변경하지 않는다.
 *
 * 실패·보안 경계:
 * - root 탈출, symlink, 차단 파일, 비정상 file type과 target 충돌을 거부한다.
 */

import { glob, lstat, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, matchesGlob, posix, relative, resolve, sep } from "node:path";

import type { ContextEntry, LoadedConfig } from "../config/types.js";
import { BuildPouchError } from "../errors.js";

export interface PlannedFile {
  "source": string;
  "target": string;
  "size": number;
}

export interface InspectionResult {
  "schemaVersion": 1;
  "context": {
    "name": string;
    "root": string;
    "configFile": string;
  };
  "files": PlannedFile[];
  "summary": {
    "files": number;
    "totalSize": number;
  };
}

const blockedDirectories = new Set([".cache", ".git", ".hg", ".svn", ".nx", ".npm", ".pnpm-store", "node_modules"]);
const blockedNames = new Set([
  ".ds_store", "application_default_credentials.json", "credentials.json",
  "id_dsa", "id_ecdsa", "id_ed25519", "id_rsa"
]);

function normalizePortablePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function assertRelativePath(value: string, field: string, allowGlob: boolean): string {
  const portable = normalizePortablePath(value);
  const windowsAbsolute = /^[A-Za-z]:\//.test(portable) || portable.startsWith("//");

  if (isAbsolute(value) || posix.isAbsolute(portable) || windowsAbsolute) {
    throw new BuildPouchError("UNSAFE_PATH", `${field} must be relative: ${value}.`);
  }

  const normalized = posix.normalize(portable);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new BuildPouchError("UNSAFE_PATH", `${field} escapes its allowed root: ${value}.`);
  }

  if (!allowGlob && /[*?{}[\]]/.test(normalized)) {
    throw new BuildPouchError("UNSAFE_PATH", `${field} cannot contain glob syntax: ${value}.`);
  }

  return normalized;
}

function resolveInside(root: string, portablePath: string, field: string): string {
  const candidate = resolve(root, ...portablePath.split("/"));
  const pathFromRoot = relative(root, candidate);

  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new BuildPouchError("UNSAFE_PATH", `${field} escapes context.root: ${portablePath}.`);
  }

  return candidate;
}

function toPortableRelative(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join("/");
}

function assertNotBlocked(source: string): void {
  const lowerSource = source.toLowerCase();
  const segments = lowerSource.split("/");
  const name = segments.at(-1) ?? "";

  const blockedDirectory = segments.find((segment) => blockedDirectories.has(segment));
  const cloudCredentialDirectory = segments.includes(".aws") || segments.includes(".azure") || segments.includes(".kube") || lowerSource.includes(".config/gcloud/");
  const packageCache = lowerSource.includes(".yarn/cache/") || lowerSource.includes(".yarn/unplugged/") || lowerSource.endsWith(".yarn/install-state.gz");
  const environmentFile = name === ".env" || name.startsWith(".env.");
  const privateMaterial = /\.(key|pem|p12|pfx)$/.test(name);
  const serviceAccount = /^service[-_.]?account.*\.json$/.test(name);
  const temporaryFile = name.endsWith(".swp") || name.endsWith("~");

  if (blockedDirectory !== undefined || cloudCredentialDirectory || packageCache || environmentFile || privateMaterial || serviceAccount || temporaryFile || blockedNames.has(name)) {
    throw new BuildPouchError("BLOCKED_SECRET", `Blocked file or directory selected by context entry: ${source}.`);
  }
}

function isExcluded(source: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(source, pattern));
}

async function assertNoSymlink(root: string, absolutePath: string, source: string): Promise<void> {
  const metadata = await lstat(absolutePath);
  if (metadata.isSymbolicLink()) {
    throw new BuildPouchError("UNSAFE_PATH", `Symbolic links are not supported: ${source}.`);
  }

  const resolvedPath = await realpath(absolutePath);
  resolveInside(root, toPortableRelative(root, resolvedPath), "source");
  if (resolvedPath !== absolutePath) {
    throw new BuildPouchError("UNSAFE_PATH", `Source resolves through a symbolic link: ${source}.`);
  }
}

async function collectDirectoryFiles(root: string, directory: string, exclude: string[]): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { "withFileTypes": true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = resolve(directory, entry.name);
    const source = toPortableRelative(root, absolutePath);
    assertNotBlocked(source);

    if (isExcluded(source, exclude)) {
      continue;
    }

    if (entry.isSymbolicLink()) {
      throw new BuildPouchError("UNSAFE_PATH", `Symbolic links are not supported: ${source}.`);
    }

    if (entry.isDirectory()) {
      files.push(...await collectDirectoryFiles(root, absolutePath, exclude));
      continue;
    }

    if (!entry.isFile()) {
      throw new BuildPouchError("UNSAFE_PATH", `Unsupported filesystem entry: ${source}.`);
    }

    files.push(absolutePath);
  }

  return files;
}

function staticGlobBase(pattern: string): string {
  const segments = pattern.split("/");
  const firstGlobIndex = segments.findIndex((segment) => /[*?{}[\]]/.test(segment));
  const baseSegments = firstGlobIndex === -1 ? segments.slice(0, -1) : segments.slice(0, firstGlobIndex);

  return baseSegments.length === 0 ? "." : baseSegments.join("/");
}

function targetForFile(target: string, relativeFile: string, singleFile: boolean): string {
  const normalizedTarget = assertRelativePath(target, "entry.target", false);
  const combined = singleFile
    ? (normalizedTarget === "." ? posix.basename(relativeFile) : normalizedTarget)
    : posix.join(normalizedTarget, relativeFile);

  return assertRelativePath(combined, "archive target", false);
}

async function expandEntry(root: string, entry: ContextEntry, exclude: string[]): Promise<Array<{ "absolutePath": string; "target": string }>> {
  const sourcePattern = assertRelativePath(entry.source, "entry.source", true);
  const hasGlob = /[*?{}[\]]/.test(sourcePattern);
  const expanded: Array<{ "absolutePath": string; "target": string }> = [];

  if (!hasGlob) {
    const absolutePath = resolveInside(root, sourcePattern, "entry.source");
    let metadata;

    try {
      metadata = await lstat(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return expanded;
      }
      throw error;
    }

    await assertNoSymlink(root, absolutePath, sourcePattern);
    assertNotBlocked(sourcePattern);

    if (isExcluded(sourcePattern, exclude)) {
      return expanded;
    }

    if (metadata.isFile()) {
      expanded.push({ "absolutePath": absolutePath, "target": targetForFile(entry.target, sourcePattern, true) });
      return expanded;
    }

    if (!metadata.isDirectory()) {
      throw new BuildPouchError("UNSAFE_PATH", `Unsupported filesystem entry: ${sourcePattern}.`);
    }

    for (const file of await collectDirectoryFiles(root, absolutePath, exclude)) {
      expanded.push({
        "absolutePath": file,
        "target": targetForFile(entry.target, toPortableRelative(absolutePath, file), false)
      });
    }

    return expanded;
  }

  const base = resolveInside(root, staticGlobBase(sourcePattern), "entry.source");
  for await (const match of glob(sourcePattern, { "cwd": root })) {
    const absolutePath = resolveInside(root, normalizePortablePath(match), "entry.source");
    const source = toPortableRelative(root, absolutePath);
    const metadata = await lstat(absolutePath);
    await assertNoSymlink(root, absolutePath, source);
    assertNotBlocked(source);

    if (isExcluded(source, exclude)) {
      continue;
    }

    if (metadata.isFile()) {
      expanded.push({ "absolutePath": absolutePath, "target": targetForFile(entry.target, toPortableRelative(base, absolutePath), false) });
    } else if (metadata.isDirectory()) {
      for (const file of await collectDirectoryFiles(root, absolutePath, exclude)) {
        expanded.push({ "absolutePath": file, "target": targetForFile(entry.target, toPortableRelative(base, file), false) });
      }
    }
  }

  return expanded;
}

export async function planContext(loaded: LoadedConfig): Promise<InspectionResult> {
  const portableRoot = normalizePortablePath(loaded.config.context.root);
  if (/[*?{}[\]]/.test(portableRoot)) {
    throw new BuildPouchError("INVALID_CONFIGURATION", `context.root cannot contain glob syntax: ${loaded.config.context.root}.`);
  }

  const requestedRoot = isAbsolute(loaded.config.context.root) || posix.isAbsolute(portableRoot)
    ? resolve(loaded.config.context.root)
    : resolve(loaded.configDirectory, ...portableRoot.split("/"));
  let root: string;

  try {
    root = await realpath(requestedRoot);
    const rootMetadata = await stat(root);
    if (!rootMetadata.isDirectory()) {
      throw new BuildPouchError("INVALID_CONFIGURATION", `context.root is not a directory: ${requestedRoot}.`);
    }
  } catch (error) {
    if (error instanceof BuildPouchError) {
      throw error;
    }
    throw new BuildPouchError("INVALID_CONFIGURATION", `Unable to access context.root ${requestedRoot}.`);
  }

  const exclude = loaded.config.context.exclude.map((pattern, index) => assertRelativePath(pattern, `context.exclude[${index}]`, true));
  const plannedByTarget = new Map<string, PlannedFile>();

  for (const entry of loaded.config.context.entries) {
    const expanded = await expandEntry(root, entry, exclude);
    if (entry.required && expanded.length === 0) {
      throw new BuildPouchError("MISSING_REQUIRED_SOURCE", `Required entry did not select any files: ${entry.source}.`);
    }

    for (const file of expanded) {
      const source = toPortableRelative(root, file.absolutePath);
      const planned: PlannedFile = { "source": source, "target": file.target, "size": (await stat(file.absolutePath)).size };
      const collisionKey = file.target.toLowerCase();
      const existing = plannedByTarget.get(collisionKey);

      if (existing !== undefined) {
        if (existing.source === planned.source && existing.target === planned.target) {
          continue;
        }
        throw new BuildPouchError("TARGET_COLLISION", `Archive target collision: ${existing.source} and ${planned.source} both map to ${planned.target}.`);
      }

      const prefixCollision = [...plannedByTarget.entries()].find(([existingTarget]) =>
        collisionKey.startsWith(`${existingTarget}/`) || existingTarget.startsWith(`${collisionKey}/`)
      );
      if (prefixCollision !== undefined) {
        throw new BuildPouchError("TARGET_COLLISION", `Archive file/directory collision: ${prefixCollision[1].target} conflicts with ${planned.target}.`);
      }

      plannedByTarget.set(collisionKey, planned);
    }
  }

  const files = [...plannedByTarget.values()].sort((left, right) => left.target.localeCompare(right.target) || left.source.localeCompare(right.source));
  return {
    "schemaVersion": 1,
    "context": {
      "name": loaded.config.context.name,
      "root": root,
      "configFile": loaded.configFile
    },
    "files": files,
    "summary": {
      "files": files.length,
      "totalSize": files.reduce((total, file) => total + file.size, 0)
    }
  };
}
