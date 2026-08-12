/**
 * staging directory의 최상위 항목을 portable gzip tar archive로 기록한다.
 *
 * 실패·보안 경계:
 * - 고유한 sibling 임시 파일에 먼저 쓰고, force 없이는 hard link로 원자적으로 확정한다.
 * - 실패와 취소 시 부분 archive를 제거한다.
 */

import { createWriteStream } from "node:fs";
import { access, chmod, link, readdir, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { create, Pack } from "tar";

import { BuildPouchError } from "../errors.js";

export interface ArchiveOptions {
  "force": boolean;
  "signal"?: AbortSignal;
}

function toArchiveError(error: unknown, output: string, signal?: AbortSignal): BuildPouchError {
  if (error instanceof BuildPouchError) {
    return error;
  }
  if (error instanceof Error && error.name === "AbortError") {
    if (signal?.reason instanceof BuildPouchError) {
      return signal.reason;
    }
    return new BuildPouchError("USER_CANCELLATION", "Archive creation cancelled by user.", 130);
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new BuildPouchError("ARCHIVE_CREATION_FAILED", `Unable to create archive ${output}: ${detail}`);
}

export async function createArchive(contextDirectory: string, outputPath: string, options: ArchiveOptions): Promise<{ "path": string; "size": number }> {
  const output = resolve(outputPath);
  const temporaryArchive = join(dirname(output), `.${basename(output)}.${randomUUID()}.tmp`);

  if (!options.force) {
    try {
      await access(output);
      throw new BuildPouchError("OUTPUT_EXISTS", `Archive already exists: ${output}. Use --force to replace it.`);
    } catch (error) {
      if (error instanceof BuildPouchError) {
        throw error;
      }
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw toArchiveError(error, output, options.signal);
      }
    }
  }

  try {
    const entries = (await readdir(contextDirectory)).sort();
    const tarOptions = {
      "cwd": contextDirectory,
      "gzip": true,
      "noMtime": true,
      "portable": true,
      "strict": true
    };
    const archive = entries.length === 0 ? new Pack(tarOptions) : create(tarOptions, entries);
    if (entries.length === 0) {
      queueMicrotask(() => archive.end());
    }
    await pipeline(archive, createWriteStream(temporaryArchive, { "flags": "wx", "mode": 0o600 }), { "signal": options.signal });
    await chmod(temporaryArchive, 0o600);

    if (options.force) {
      await rename(temporaryArchive, output);
    } else {
      try {
        await link(temporaryArchive, output);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new BuildPouchError("OUTPUT_EXISTS", `Archive already exists: ${output}. Use --force to replace it.`);
        }
        throw error;
      }
    }

    return { "path": output, "size": (await stat(output)).size };
  } catch (error) {
    throw toArchiveError(error, output, options.signal);
  } finally {
    try {
      await rm(temporaryArchive, { "force": true });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new BuildPouchError("ARCHIVE_CREATION_FAILED", `Unable to remove partial archive ${temporaryArchive}: ${detail}`);
    }
  }
}
