/**
 * submit용 archive 준비, provider 호출과 임시 산출물 정리를 조합한다.
 *
 * 데이터·부수효과:
 * - `--archive`가 없으면 임시 archive를 만들고 제출 종료 후 제거한다.
 * - 기존 archive와 source workspace는 읽기만 한다.
 *
 * 실패·보안 경계:
 * - build configuration과 archive가 일반 파일인지 확인한다.
 * - provider에는 정규화된 절대 경로와 검증된 최종 설정만 전달한다.
 */

import { chmod, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import type { GcpCloudBuildOptions, LoadedConfig } from "./config/types.js";
import { packContext } from "./context/pack.js";
import { BuildPouchError } from "./errors.js";
import { createGcpCloudBuildProvider } from "./providers/gcp-cloud-build.js";
import type { BuildProvider, ProviderBuildResult } from "./providers/types.js";

export interface PreparedSubmission {
  "context": {
    "name": string;
    "summary"?: {
      "files": number;
      "totalSize": number;
    };
  };
  "archive": {
    "path": string;
    "size": number;
    "temporary": boolean;
  };
  "provider": {
    "name": "gcp-cloud-build";
    "target"?: string;
    "project": string;
    "region": string;
    "config": string;
    "substitutions": Record<string, string>;
  };
}

export interface SubmitResult extends PreparedSubmission {
  "schemaVersion": 1;
  "build": ProviderBuildResult;
}

export interface SubmitOptions {
  "cwd": string;
  "archive"?: string;
  "project"?: string;
  "region"?: string;
  "buildConfig"?: string;
  "target"?: string;
  "substitutions": Record<string, string>;
  "signal"?: AbortSignal;
  "onPrepared"?: (submission: PreparedSubmission) => void;
  "onProviderStderr"?: (chunk: string) => void;
  "provider"?: BuildProvider;
}

interface SelectedBuild {
  "options": GcpCloudBuildOptions;
  "target"?: string;
}

function selectBuild(loaded: LoadedConfig, requestedTarget?: string): SelectedBuild {
  if (requestedTarget !== undefined) {
    const target = loaded.config.targets[requestedTarget];
    if (target === undefined) {
      throw new BuildPouchError("PROVIDER_TARGET_NOT_FOUND", `Unknown build target: ${requestedTarget}.`);
    }
    return { "options": target.options, "target": requestedTarget };
  }

  if (loaded.config.defaultTarget !== undefined) {
    const name = loaded.config.defaultTarget;
    return { "options": loaded.config.targets[name]!.options, "target": name };
  }

  if (loaded.config.build !== undefined) {
    return { "options": loaded.config.build };
  }

  const targets = Object.entries(loaded.config.targets);
  if (targets.length === 1) {
    const [name, target] = targets[0]!;
    return { "options": target.options, "target": name };
  }
  if (targets.length > 1) {
    throw new BuildPouchError("PROVIDER_TARGET_REQUIRED", "submit requires --target or defaultTarget when multiple build targets are configured.");
  }

  throw new BuildPouchError("PROVIDER_NOT_CONFIGURED", "submit requires a build section or at least one named target in the configuration file.");
}

async function regularFile(path: string, label: string): Promise<{ "path": string; "size": number }> {
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(path);
    const metadata = await stat(resolvedPath);
    if (!metadata.isFile()) {
      throw new BuildPouchError("INVALID_CONFIGURATION", `${label} is not a regular file: ${path}.`);
    }
    return { "path": resolvedPath, "size": metadata.size };
  } catch (error) {
    if (error instanceof BuildPouchError) {
      throw error;
    }
    throw new BuildPouchError("INVALID_CONFIGURATION", `Unable to access ${label.toLowerCase()} ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveConfiguredPath(value: string, configDirectory: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(configDirectory, value);
}

async function cleanupSubmission(directory: string): Promise<void> {
  try {
    await rm(directory, { "recursive": true, "force": true });
  } catch {
    throw new BuildPouchError("SUBMISSION_CLEANUP_FAILED", `Unable to remove temporary submission directory: ${directory}.`);
  }
}

async function createSubmissionDirectory(): Promise<string> {
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "buildpouch-submit-"));
    await chmod(directory, 0o700);
    return directory;
  } catch (error) {
    if (directory !== undefined) {
      try {
        await rm(directory, { "recursive": true, "force": true });
      } catch {
        throw new BuildPouchError("SUBMISSION_CLEANUP_FAILED", `Unable to secure or remove temporary submission directory: ${directory}.`);
      }
    }
    throw new BuildPouchError("CONTEXT_BUILD_FAILED", `Unable to create temporary submission directory: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function submitContext(loaded: LoadedConfig, options: SubmitOptions): Promise<SubmitResult> {
  const selectedBuild = selectBuild(loaded, options.target);
  const configuredBuild = selectedBuild.options;

  const project = options.project ?? configuredBuild.project;
  const region = options.region ?? configuredBuild.region;
  const configuredBuildPath = options.buildConfig === undefined
    ? resolveConfiguredPath(configuredBuild.config, loaded.configDirectory)
    : resolve(options.cwd, options.buildConfig);
  const buildConfig = await regularFile(configuredBuildPath, "Build configuration");
  const substitutions = { ...configuredBuild.substitutions, ...options.substitutions };
  let temporaryDirectory: string | undefined;
  let prepared: PreparedSubmission;

  try {
    if (options.archive !== undefined) {
      const archive = await regularFile(resolve(options.cwd, options.archive), "Archive");
      prepared = {
        "context": { "name": loaded.config.context.name },
        "archive": { ...archive, "temporary": false },
        "provider": {
          "name": "gcp-cloud-build",
          ...(selectedBuild.target === undefined ? {} : { "target": selectedBuild.target }),
          project,
          region,
          "config": buildConfig.path,
          substitutions
        }
      };
    } else {
      temporaryDirectory = await createSubmissionDirectory();
      const packed = await packContext(loaded, {
        "cwd": temporaryDirectory,
        "force": false,
        "keepContext": false,
        ...(options.signal === undefined ? {} : { "signal": options.signal })
      });
      prepared = {
        "context": { "name": loaded.config.context.name, "summary": packed.summary },
        "archive": { ...packed.archive, "temporary": true },
        "provider": {
          "name": "gcp-cloud-build",
          ...(selectedBuild.target === undefined ? {} : { "target": selectedBuild.target }),
          project,
          region,
          "config": buildConfig.path,
          substitutions
        }
      };
    }

    options.onPrepared?.(prepared);
    const provider = options.provider ?? createGcpCloudBuildProvider();
    const build = await provider.submit({
      "archive": prepared.archive.path,
      "buildConfig": prepared.provider.config,
      "project": prepared.provider.project,
      "region": prepared.provider.region,
      "substitutions": prepared.provider.substitutions,
      ...(options.signal === undefined ? {} : { "signal": options.signal }),
      ...(options.onProviderStderr === undefined ? {} : { "onStderr": options.onProviderStderr })
    });

    return { "schemaVersion": 1, ...prepared, build };
  } finally {
    if (temporaryDirectory !== undefined) {
      await cleanupSubmission(temporaryDirectory);
    }
  }
}
