/**
 * inspect, staging, archive 작성과 정리를 하나의 pack 작업으로 조합한다.
 */

import { resolve } from "node:path";
import { realpath } from "node:fs/promises";

import type { LoadedConfig } from "../config/types.js";
import { BuildPouchError } from "../errors.js";
import { createArchive } from "./archive.js";
import { buildContext, cleanupContext } from "./build.js";
import { planContext } from "./plan.js";

export interface PackOptions {
  "cwd": string;
  "force": boolean;
  "keepContext": boolean;
  "output"?: string;
  "signal"?: AbortSignal;
  "temporaryDirectory"?: string;
}

export interface PackResult {
  "schemaVersion": 1;
  "context": {
    "name": string;
    "directory"?: string;
  };
  "archive": {
    "path": string;
    "size": number;
  };
  "summary": {
    "files": number;
    "totalSize": number;
  };
}

export async function packContext(loaded: LoadedConfig, options: PackOptions): Promise<PackResult> {
  const inspection = await planContext(loaded);
  const output = resolve(options.cwd, options.output ?? `${inspection.context.name}.context.tar.gz`);
  let comparableOutput = output;
  try {
    comparableOutput = await realpath(output);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const protectedPaths = [await realpath(loaded.configFile), ...inspection.files.map((file) => resolve(inspection.context.root, ...file.source.split("/")))];

  if (protectedPaths.some((protectedPath) => protectedPath === comparableOutput)) {
    throw new BuildPouchError("UNSAFE_PATH", `Archive output would overwrite an input file: ${output}.`);
  }

  const built = await buildContext(inspection, {
    "keepContext": options.keepContext,
    ...(options.signal === undefined ? {} : { "signal": options.signal }),
    ...(options.temporaryDirectory === undefined ? {} : { "temporaryDirectory": options.temporaryDirectory })
  });

  try {
    const archive = await createArchive(built.directory, output, {
      "force": options.force,
      ...(options.signal === undefined ? {} : { "signal": options.signal })
    });
    const result: PackResult = {
      "schemaVersion": 1,
      "context": {
        "name": inspection.context.name,
        ...(options.keepContext ? { "directory": built.directory } : {})
      },
      "archive": archive,
      "summary": inspection.summary
    };

    return result;
  } finally {
    if (!options.keepContext) {
      await cleanupContext(built.directory);
    }
  }
}
