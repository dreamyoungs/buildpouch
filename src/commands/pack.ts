/**
 * `buildpouch pack` 인자를 검증하고 취소 signal을 context pack 작업에 연결한다.
 */

import { loadConfig } from "../config/load.js";
import { packContext } from "../context/pack.js";
import { BuildPouchError } from "../errors.js";
import { formatPackHuman, formatPackJson } from "../output/pack.js";

export const packHelpText = `Usage:
  buildpouch pack [--config <path>] [--output <path>] [--force] [--keep-context] [--json]

Options:
  --config <path>    Configuration file (default: buildpouch.yaml).
  --output <path>    Archive path (default: <context.name>.context.tar.gz).
  --force            Replace an existing archive.
  --keep-context     Keep the temporary staging directory for debugging.
  --json             Print a machine-readable pack result.
  -h, --help         Show this help message.
`;

interface PackCommandOptions {
  "config": string;
  "force": boolean;
  "help": boolean;
  "json": boolean;
  "keepContext": boolean;
  "output"?: string;
}

function readValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new BuildPouchError("INVALID_ARGUMENT", `${option} requires a path.`);
  }
  return value;
}

function parsePackOptions(args: string[]): PackCommandOptions {
  const options: PackCommandOptions = { "config": "buildpouch.yaml", "force": false, "help": false, "json": false, "keepContext": false };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--config") {
      options.config = readValue(args, index, argument);
      index += 1;
    } else if (argument === "--output") {
      options.output = readValue(args, index, argument);
      index += 1;
    } else if (argument === "--force") {
      options.force = true;
    } else if (argument === "--keep-context") {
      options.keepContext = true;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new BuildPouchError("INVALID_ARGUMENT", `Unknown pack option: ${argument ?? ""}.`);
    }
  }

  return options;
}

export async function runPack(args: string[]): Promise<number> {
  const options = parsePackOptions(args);
  if (options.help) {
    process.stdout.write(packHelpText);
    return 0;
  }

  const controller = new AbortController();
  const onSigint = (): void => controller.abort(new BuildPouchError("USER_CANCELLATION", "Pack cancelled by SIGINT.", 130));
  const onSigterm = (): void => controller.abort(new BuildPouchError("USER_CANCELLATION", "Pack cancelled by SIGTERM.", 143));
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    const loaded = await loadConfig(options.config);
    const result = await packContext(loaded, {
      "cwd": process.cwd(),
      "force": options.force,
      "keepContext": options.keepContext,
      "signal": controller.signal,
      ...(options.output === undefined ? {} : { "output": options.output })
    });
    process.stdout.write(options.json ? formatPackJson(result) : formatPackHuman(result));
    return 0;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}
