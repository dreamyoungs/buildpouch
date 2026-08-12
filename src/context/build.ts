/**
 * inspect가 확정한 파일을 사용자 전용 임시 디렉터리에 복사한다.
 *
 * 데이터·부수효과:
 * - source는 읽기만 하고 staging directory만 생성·변경한다.
 * - 원본 실행 권한을 복사본에 적용한다.
 *
 * 실패·보안 경계:
 * - 복사 직전과 직후 source가 일반 파일인지 다시 확인한다.
 * - 기본적으로 실패와 취소 시 staging directory를 제거한다.
 */

import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

import type { InspectionResult } from "./plan.js";
import { BuildPouchError } from "../errors.js";

export interface BuildContextOptions {
  "keepContext": boolean;
  "signal"?: AbortSignal;
  "temporaryDirectory"?: string;
}

export interface BuiltContext {
  "directory": string;
}

function cancellationError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new BuildPouchError("USER_CANCELLATION", "Operation cancelled by user.", 130);
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw cancellationError(signal);
  }
}

function resolveTarget(directory: string, target: string): string {
  const destination = resolve(directory, ...target.split("/"));
  const fromDirectory = relative(directory, destination);

  if (fromDirectory === ".." || fromDirectory.startsWith(`..${sep}`)) {
    throw new BuildPouchError("UNSAFE_PATH", `Archive target escapes staging directory: ${target}.`);
  }

  return destination;
}

async function removeContext(directory: string): Promise<void> {
  try {
    await rm(directory, { "recursive": true, "force": true });
  } catch {
    throw new BuildPouchError("CONTEXT_CLEANUP_FAILED", `Unable to remove temporary context: ${directory}.`);
  }
}

export async function buildContext(inspection: InspectionResult, options: BuildContextOptions): Promise<BuiltContext> {
  const temporaryDirectory = options.temporaryDirectory ?? tmpdir();
  let directory: string;

  try {
    directory = await mkdtemp(join(temporaryDirectory, "buildpouch-"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new BuildPouchError("CONTEXT_BUILD_FAILED", `Unable to create temporary context: ${detail}`);
  }

  try {
    await chmod(directory, 0o700);
    for (const file of inspection.files) {
      assertNotAborted(options.signal);
      const source = resolve(inspection.context.root, ...file.source.split("/"));
      const destination = resolveTarget(directory, file.target);
      const before = await lstat(source);
      const sourceRealPath = await realpath(source);

      if (!before.isFile() || before.isSymbolicLink() || sourceRealPath !== source || before.size !== file.size) {
        throw new BuildPouchError("SOURCE_CHANGED", `Source changed after inspection: ${file.source}.`);
      }

      await mkdir(dirname(destination), { "recursive": true, "mode": 0o700 });
      await copyFile(source, destination, constants.COPYFILE_EXCL);
      await chmod(destination, before.mode & 0o777);

      const [sourceAfter, destinationAfter] = await Promise.all([lstat(source), stat(destination)]);
      if (!sourceAfter.isFile() || sourceAfter.isSymbolicLink() || sourceAfter.size !== before.size || sourceAfter.mtimeMs !== before.mtimeMs || destinationAfter.size !== before.size) {
        throw new BuildPouchError("SOURCE_CHANGED", `Source changed while it was copied: ${file.source}.`);
      }
    }

    assertNotAborted(options.signal);
    return { "directory": directory };
  } catch (error) {
    const buildError = error instanceof BuildPouchError
      ? error
      : new BuildPouchError("CONTEXT_BUILD_FAILED", `Unable to build temporary context: ${error instanceof Error ? error.message : String(error)}`);

    if (!options.keepContext) {
      try {
        await removeContext(directory);
      } catch (cleanupError) {
        const detail = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        throw new BuildPouchError("CONTEXT_CLEANUP_FAILED", `${detail} Original failure: ${buildError.message}`);
      }
    } else {
      throw new BuildPouchError(buildError.code, `${buildError.message} Temporary context kept at ${directory}.`, buildError.exitCode);
    }
    throw buildError;
  }
}

export async function cleanupContext(directory: string): Promise<void> {
  await removeContext(directory);
}
