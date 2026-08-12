#!/usr/bin/env node

/**
 * `buildpouch` 실행 파일의 최상위 인자 처리와 기본 안내 출력을 담당한다.
 *
 * 호출 관계:
 * - 진입: npm의 `buildpouch` bin 또는 컴파일된 `dist/cli.js`
 * - 후속: `inspect`, `pack`, `submit` 구현이 추가되면 각 명령 모듈로 위임한다.
 *
 * 데이터·부수효과:
 * - `package.json`에서 현재 버전을 읽고 표준 출력 또는 표준 오류에 결과를 쓴다.
 * - 현재 단계에서는 파일이나 네트워크를 변경하지 않는다.
 *
 * 실패·보안 경계:
 * - 미구현 명령과 알 수 없는 인자는 종료 코드 1로 반환한다.
 */

import { readFileSync } from "node:fs";

const plannedCommands = new Set(["inspect", "pack", "submit"]);

const helpText = `BuildPouch — Pack only what your build needs.

Usage:
  buildpouch <command> [options]
  buildpouch --help
  buildpouch --version

Commands (planned):
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

function run(args: string[]): number {
  const [firstArgument] = args;

  if (firstArgument === undefined || firstArgument === "--help" || firstArgument === "-h" || firstArgument === "help") {
    process.stdout.write(helpText);
    return 0;
  }

  if (firstArgument === "--version" || firstArgument === "-v") {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }

  if (plannedCommands.has(firstArgument)) {
    process.stderr.write(`Command "${firstArgument}" is not implemented yet.\n`);
    return 1;
  }

  process.stderr.write(`Unknown command or option: ${firstArgument}\nRun "buildpouch --help" for usage.\n`);
  return 1;
}

process.exitCode = run(process.argv.slice(2));
