/**
 * `buildpouch dependencies check` 인자를 검증하고 lockfile 공급망 검사를 실행한다.
 */

import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { checkDependencies, type DependencyCheckResult } from "../dependencies/check.js";
import { BuildPouchError } from "../errors.js";

export const dependenciesHelpText = `Usage:
  buildpouch dependencies check [options]

Options:
  --lockfile <path>                 Lockfile path (auto-detects package-lock.json or pnpm-lock.yaml).
  --baseline-lockfile <path>        Trusted baseline lockfile used to detect new package names.
  --minimum-release-age <duration>  Minimum release age such as 168h or 7d (default: 7d).
  --registry <url>                  HTTPS npm-compatible registry (default: https://registry.npmjs.org/).
  --allow-install-script <selector> Allow lifecycle scripts for one exact name@version; repeatable.
  --allow-new-package <selector>    Allow one new exact name@version; repeatable.
  --allow-release-age <selector>    Allow one exact name@version before the minimum age; repeatable.
  --json                            Print a machine-readable result.
  -h, --help                        Show this help message.
`;

interface CommandOptions {
  "allowInstallScripts": Set<string>;
  "allowNewPackages": Set<string>;
  "allowReleaseAges": Set<string>;
  "help": boolean;
  "json": boolean;
  "minimumReleaseAgeHours": number;
  "registry": string;
  "baselineLockfile"?: string;
  "lockfile"?: string;
}

function value(args: string[], index: number, option: string): string {
  const result = args[index + 1];
  if (result === undefined || result.startsWith("-")) throw new BuildPouchError("INVALID_ARGUMENT", `${option} requires a value.`);
  return result;
}

function durationHours(input: string): number {
  const match = /^(\d+)(h|d)$/.exec(input);
  if (match === null) throw new BuildPouchError("INVALID_ARGUMENT", "--minimum-release-age must use whole hours or days, such as 168h or 7d.");
  const amount = Number(match[1]);
  const hours = match[2] === "d" ? amount * 24 : amount;
  if (hours < 1 || hours > 8760) throw new BuildPouchError("INVALID_ARGUMENT", "--minimum-release-age must be between 1 hour and 365 days.");
  return hours;
}

function parseOptions(args: string[]): CommandOptions {
  if (args[0] !== "check" && !["--help", "-h"].includes(args[0] ?? "")) {
    throw new BuildPouchError("INVALID_ARGUMENT", "dependencies requires the check subcommand.");
  }
  const options: CommandOptions = {
    "allowInstallScripts": new Set(), "allowNewPackages": new Set(), "allowReleaseAges": new Set(), "help": false, "json": false,
    "minimumReleaseAgeHours": 168, "registry": "https://registry.npmjs.org/"
  };
  const start = args[0] === "check" ? 1 : 0;
  for (let index = start; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--json") options.json = true;
    else if (["--lockfile", "--baseline-lockfile", "--minimum-release-age", "--registry", "--allow-install-script", "--allow-new-package", "--allow-release-age"].includes(argument ?? "")) {
      const optionValue = value(args, index, argument ?? "");
      index += 1;
      if (argument === "--lockfile") options.lockfile = optionValue;
      else if (argument === "--baseline-lockfile") options.baselineLockfile = optionValue;
      else if (argument === "--minimum-release-age") options.minimumReleaseAgeHours = durationHours(optionValue);
      else if (argument === "--registry") {
        const registry = new URL(optionValue);
        if (registry.protocol !== "https:" || registry.username !== "" || registry.password !== "") throw new BuildPouchError("INVALID_ARGUMENT", "--registry must be an HTTPS URL without credentials.");
        options.registry = registry.href;
      } else if (optionValue.lastIndexOf("@") <= 0 || optionValue.endsWith("@")) throw new BuildPouchError("INVALID_ARGUMENT", `${argument} requires an exact name@version selector.`);
      else if (argument === "--allow-install-script") options.allowInstallScripts.add(optionValue);
      else if (argument === "--allow-new-package") options.allowNewPackages.add(optionValue);
      else options.allowReleaseAges.add(optionValue);
    } else throw new BuildPouchError("INVALID_ARGUMENT", `Unknown dependencies option: ${argument ?? ""}.`);
  }
  return options;
}

async function detectLockfile(): Promise<string> {
  for (const candidate of ["package-lock.json", "pnpm-lock.yaml"]) {
    try {
      await access(candidate);
      return resolve(candidate);
    } catch { /* 다음 지원 lockfile을 확인한다. */ }
  }
  throw new BuildPouchError("INVALID_CONFIGURATION", "No supported lockfile was found.");
}

function human(result: DependencyCheckResult): string {
  const lines = [
    `Dependency policy: ${result.ok ? "PASS" : "BLOCKED"}`,
    `Lockfile: ${result.lockfile.path} (${result.lockfile.format})`,
    `Packages: ${result.summary.packages}`,
    `Changed versions: ${result.summary.changedVersions}`,
    `New packages: ${result.summary.newPackages}`,
    `Violations: ${result.summary.violations}`
  ];
  for (const violation of result.violations) {
    lines.push("", `${violation.code} ${violation.package}`, `  ${violation.message}`, `  Path: ${violation.path.join(" -> ")}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function runDependencies(args: string[]): Promise<number> {
  const options = parseOptions(args);
  if (options.help) {
    process.stdout.write(dependenciesHelpText);
    return 0;
  }
  const result = await checkDependencies({
    "lockfile": options.lockfile ?? await detectLockfile(),
    "minimumReleaseAgeHours": options.minimumReleaseAgeHours,
    "registry": options.registry,
    "allowInstallScripts": options.allowInstallScripts,
    "allowNewPackages": options.allowNewPackages,
    "allowReleaseAges": options.allowReleaseAges,
    ...(options.baselineLockfile === undefined ? {} : { "baselineLockfile": options.baselineLockfile })
  });
  process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : human(result));
  return result.ok ? 0 : 1;
}
