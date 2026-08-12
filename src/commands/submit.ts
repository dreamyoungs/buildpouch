/**
 * `buildpouch submit` 인자를 검증하고 provider 제출 수명주기를 관리한다.
 */

import { loadConfig } from "../config/load.js";
import { BuildPouchError } from "../errors.js";
import { formatSubmitJson, formatSubmitPreparedHuman, formatSubmitResultHuman } from "../output/submit.js";
import { submitContext } from "../submit.js";

export const submitHelpText = `Usage:
  buildpouch submit [--config <path>] [--target <name>] [--archive <path>] [provider overrides] [--json]

Options:
  --config <path>           Configuration file (default: buildpouch.yaml).
  --target <name>           Select a named build target.
  --archive <path>          Submit an existing archive instead of packing context.
  --project <id>            Override the selected GCP project.
  --region <region>         Override the selected GCP region.
  --build-config <path>     Override the selected GCP config path.
  --substitution <key=value> Override one GCP substitution; repeat for multiple values.
  --json                    Print a machine-readable submit result.
  -h, --help                Show this help message.
`;

interface SubmitCommandOptions {
  "config": string;
  "help": boolean;
  "json": boolean;
  "substitutions": Record<string, string>;
  "archive"?: string;
  "target"?: string;
  "project"?: string;
  "region"?: string;
  "buildConfig"?: string;
}

function readValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new BuildPouchError("INVALID_ARGUMENT", `${option} requires a value.`);
  }
  return value;
}

function readSubstitution(value: string): [string, string] {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new BuildPouchError("INVALID_ARGUMENT", "--substitution requires a non-empty key=value pair.");
  }
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function parseSubmitOptions(args: string[]): SubmitCommandOptions {
  const options: SubmitCommandOptions = { "config": "buildpouch.yaml", "help": false, "json": false, "substitutions": {} };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--config", "--target", "--archive", "--project", "--region", "--build-config", "--substitution"].includes(argument ?? "")) {
      const value = readValue(args, index, argument ?? "");
      index += 1;
      if (argument === "--config") options.config = value;
      else if (argument === "--target") options.target = value;
      else if (argument === "--archive") options.archive = value;
      else if (argument === "--project") options.project = value;
      else if (argument === "--region") options.region = value;
      else if (argument === "--build-config") options.buildConfig = value;
      else {
        const [key, substitution] = readSubstitution(value);
        options.substitutions[key] = substitution;
      }
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new BuildPouchError("INVALID_ARGUMENT", `Unknown submit option: ${argument ?? ""}.`);
    }
  }
  return options;
}

export async function runSubmit(args: string[]): Promise<number> {
  const options = parseSubmitOptions(args);
  if (options.help) {
    process.stdout.write(submitHelpText);
    return 0;
  }

  const controller = new AbortController();
  const onSigint = (): void => controller.abort(new BuildPouchError("USER_CANCELLATION", "Submit cancelled by SIGINT.", 130));
  const onSigterm = (): void => controller.abort(new BuildPouchError("USER_CANCELLATION", "Submit cancelled by SIGTERM.", 143));
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    const loaded = await loadConfig(options.config);
    const result = await submitContext(loaded, {
      "cwd": process.cwd(),
      "substitutions": options.substitutions,
      "signal": controller.signal,
      "onProviderStderr": (chunk) => process.stderr.write(chunk),
      ...(options.json ? {} : { "onPrepared": (prepared) => process.stdout.write(formatSubmitPreparedHuman(prepared)) }),
      ...(options.archive === undefined ? {} : { "archive": options.archive }),
      ...(options.target === undefined ? {} : { "target": options.target }),
      ...(options.project === undefined ? {} : { "project": options.project }),
      ...(options.region === undefined ? {} : { "region": options.region }),
      ...(options.buildConfig === undefined ? {} : { "buildConfig": options.buildConfig })
    });
    process.stdout.write(options.json ? formatSubmitJson(result) : formatSubmitResultHuman(result));
    return 0;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}
