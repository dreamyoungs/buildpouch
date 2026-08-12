/**
 * `buildpouch inspect` 인자를 검증하고 설정 로딩, 계획 수립, 출력 단계를 연결한다.
 *
 * 데이터·부수효과:
 * - 설정과 source metadata만 읽고 표준 출력에 결과를 쓴다.
 * - 파일 복사, archive 생성과 cloud 요청을 수행하지 않는다.
 */

import { loadConfig } from "../config/load.js";
import { planContext } from "../context/plan.js";
import { BuildPouchError } from "../errors.js";
import { formatInspectionHuman, formatInspectionJson } from "../output/inspect.js";

export const inspectHelpText = `Usage:
  buildpouch inspect [--config <path>] [--json]

Options:
  --config <path>    Configuration file (default: buildpouch.yaml).
  --json             Print a machine-readable inspection result.
  -h, --help         Show this help message.
`;

interface InspectOptions {
  "config": string;
  "json": boolean;
  "help": boolean;
}

function parseInspectOptions(args: string[]): InspectOptions {
  const options: InspectOptions = { "config": "buildpouch.yaml", "json": false, "help": false };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--config") {
      const config = args[index + 1];
      if (config === undefined || config.startsWith("-")) {
        throw new BuildPouchError("INVALID_ARGUMENT", "--config requires a path.");
      }
      options.config = config;
      index += 1;
    } else {
      throw new BuildPouchError("INVALID_ARGUMENT", `Unknown inspect option: ${argument ?? ""}.`);
    }
  }

  return options;
}

export async function runInspect(args: string[]): Promise<number> {
  const options = parseInspectOptions(args);

  if (options.help) {
    process.stdout.write(inspectHelpText);
    return 0;
  }

  const loaded = await loadConfig(options.config);
  const inspection = await planContext(loaded);
  process.stdout.write(options.json ? formatInspectionJson(inspection) : formatInspectionHuman(inspection));

  return 0;
}
