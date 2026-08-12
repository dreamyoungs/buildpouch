#!/usr/bin/env node

/**
 * `buildpouch` 실행 파일의 최상위 인자 처리와 기본 안내 출력을 담당한다.
 *
 * 호출 관계:
 * - 진입: npm의 `buildpouch` bin 또는 컴파일된 `dist/cli.js`
 * - 후속: `inspect`, `pack`, `submit` 명령 모듈로 위임한다.
 *
 * 데이터·부수효과:
 * - `package.json`, 설정, source metadata를 읽고 결과를 출력한다.
 * - `pack`은 archive를 만들고 `submit`은 외부 build provider를 호출할 수 있다.
 *
 * 실패·보안 경계:
 * - 알려진 오류는 안정적인 코드와 종료 코드로 출력한다.
 */

import { readFileSync } from "node:fs";

import { runInspect } from "./commands/inspect.js";
import { runPack } from "./commands/pack.js";
import { runSubmit } from "./commands/submit.js";
import { BuildPouchError } from "./errors.js";

const helpText = `BuildPouch — Pack only what your build needs.

Usage:
  buildpouch <command> [options]
  buildpouch --help
  buildpouch --version

Commands:
  inspect    Calculate and validate a build context.
  pack       Create a validated build context archive.
  submit     Submit an archive to a build provider.

Options:
  -h, --help       Show this help message.
  -v, --version    Show the installed version.
`;

interface PackageMetadata {
  "version": string;
}

function readVersion(): string {
  const packageUrl = new URL("../package.json", import.meta.url);
  const metadata = JSON.parse(readFileSync(packageUrl, "utf8")) as PackageMetadata;

  return metadata.version;
}

async function run(args: string[]): Promise<number> {
  const [firstArgument] = args;

  if (firstArgument === undefined || firstArgument === "--help" || firstArgument === "-h" || firstArgument === "help") {
    process.stdout.write(helpText);
    return 0;
  }

  if (firstArgument === "--version" || firstArgument === "-v") {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }

  if (firstArgument === "inspect") {
    return runInspect(args.slice(1));
  }

  if (firstArgument === "pack") {
    return runPack(args.slice(1));
  }

  if (firstArgument === "submit") {
    return runSubmit(args.slice(1));
  }

  process.stderr.write(`Unknown command or option: ${firstArgument}\nRun "buildpouch --help" for usage.\n`);
  return 1;
}

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  const jsonOutput = process.argv.slice(2).includes("--json");
  const publicError = error instanceof BuildPouchError
    ? error
    : new BuildPouchError("INVALID_CONFIGURATION", error instanceof Error ? error.message : String(error));

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify({ "ok": false, "error": { "code": publicError.code, "message": publicError.message } }, null, 2)}\n`);
  } else {
    process.stderr.write(`Error [${publicError.code}]: ${publicError.message}\n`);
  }
  process.exitCode = publicError.exitCode;
}
