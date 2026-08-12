/**
 * `buildpouch.yaml`을 읽어 공개 설정 계약에 맞는 값만 반환한다.
 *
 * 호출 관계:
 * - 진입: `inspect`, `pack`, `submit` 명령
 * - 협력: `yaml` parser와 `src/config/types.ts`
 *
 * 데이터·부수효과:
 * - 지정한 설정 파일 하나를 읽으며 다른 파일이나 환경을 변경하지 않는다.
 *
 * 실패·보안 경계:
 * - 중복 key, alias, 알 수 없는 field와 잘못된 타입을 거부한다.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseDocument } from "yaml";

import { BuildPouchError } from "../errors.js";
import type {
  BuildConfig,
  BuildPouchConfig,
  BuildTargetConfig,
  ContextConfig,
  ContextEntry,
  GcpCloudBuildOptions,
  LoadedConfig
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

function configurationError(message: string): never {
  throw new BuildPouchError("INVALID_CONFIGURATION", message);
}

function expectRecord(value: unknown, field: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    configurationError(`${field} must be an object.`);
  }

  return value as UnknownRecord;
}

function expectKeys(value: UnknownRecord, allowedKeys: string[], field: string): void {
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.includes(key));

  if (unknownKey !== undefined) {
    configurationError(`${field} contains an unknown field: ${unknownKey}.`);
  }
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    configurationError(`${field} must be a non-empty string.`);
  }

  return value;
}

function parseEntry(value: unknown, index: number): ContextEntry {
  const field = `context.entries[${index}]`;
  const entry = expectRecord(value, field);
  expectKeys(entry, ["source", "target", "required"], field);

  if (entry.required !== undefined && typeof entry.required !== "boolean") {
    configurationError(`${field}.required must be a boolean.`);
  }

  return {
    "source": expectString(entry.source, `${field}.source`),
    "target": expectString(entry.target, `${field}.target`),
    "required": entry.required ?? true
  };
}

function parseContext(value: unknown): ContextConfig {
  const context = expectRecord(value, "context");
  expectKeys(context, ["name", "root", "entries", "exclude"], "context");

  const name = expectString(context.name, "context.name");
  if (name === "." || name === ".." || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    configurationError("context.name may contain only letters, numbers, dots, underscores, and hyphens.");
  }

  if (!Array.isArray(context.entries) || context.entries.length === 0) {
    configurationError("context.entries must contain at least one entry.");
  }

  if (context.exclude !== undefined && !Array.isArray(context.exclude)) {
    configurationError("context.exclude must be an array of strings.");
  }

  const exclude = (context.exclude ?? []).map((pattern, index) => expectString(pattern, `context.exclude[${index}]`));

  return {
    "name": name,
    "root": expectString(context.root, "context.root"),
    "entries": context.entries.map(parseEntry),
    "exclude": exclude
  };
}

function parseGcpCloudBuildOptions(value: unknown, field: string): GcpCloudBuildOptions {
  const options = expectRecord(value, field);
  expectKeys(options, ["config", "project", "region", "substitutions"], field);

  const substitutionsValue = options.substitutions ?? {};
  const substitutionsRecord = expectRecord(substitutionsValue, `${field}.substitutions`);
  const substitutions: Record<string, string> = {};

  for (const [key, substitution] of Object.entries(substitutionsRecord)) {
    substitutions[key] = expectString(substitution, `${field}.substitutions.${key}`);
  }

  return {
    "config": expectString(options.config, `${field}.config`),
    "project": expectString(options.project, `${field}.project`),
    "region": expectString(options.region, `${field}.region`),
    substitutions
  };
}

function parseBuild(value: unknown): BuildConfig {
  const build = expectRecord(value, "build");
  expectKeys(build, ["provider", "config", "project", "region", "substitutions"], "build");

  if (build.provider !== "gcp-cloud-build") {
    configurationError('build.provider must be "gcp-cloud-build".');
  }

  return {
    "provider": "gcp-cloud-build",
    ...parseGcpCloudBuildOptions({
      "config": build.config,
      "project": build.project,
      "region": build.region,
      "substitutions": build.substitutions
    }, "build")
  };
}

function parseTarget(value: unknown, name: string): BuildTargetConfig {
  const field = `targets.${name}`;
  const target = expectRecord(value, field);
  expectKeys(target, ["provider", "options"], field);

  if (target.provider !== "gcp-cloud-build") {
    configurationError(`${field}.provider must be "gcp-cloud-build".`);
  }

  return {
    "provider": "gcp-cloud-build",
    "options": parseGcpCloudBuildOptions(target.options, `${field}.options`)
  };
}

function parseTargets(value: unknown): Record<string, BuildTargetConfig> {
  if (value === undefined) {
    return {};
  }

  const targetValues = expectRecord(value, "targets");
  const targets: Record<string, BuildTargetConfig> = {};

  for (const [name, target] of Object.entries(targetValues)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      configurationError(`Invalid target name: ${name}.`);
    }
    targets[name] = parseTarget(target, name);
  }

  return targets;
}

function parseConfiguration(value: unknown): BuildPouchConfig {
  const configuration = expectRecord(value, "configuration");
  expectKeys(configuration, ["schemaVersion", "context", "build", "defaultTarget", "targets"], "configuration");

  if (configuration.schemaVersion !== 1) {
    configurationError("schemaVersion must be 1.");
  }

  const result: BuildPouchConfig = {
    "schemaVersion": 1,
    "context": parseContext(configuration.context),
    "targets": parseTargets(configuration.targets)
  };

  if (configuration.build !== undefined) {
    result.build = parseBuild(configuration.build);
  }

  if (configuration.defaultTarget !== undefined) {
    const defaultTarget = expectString(configuration.defaultTarget, "defaultTarget");
    if (result.targets[defaultTarget] === undefined) {
      configurationError(`defaultTarget references an unknown target: ${defaultTarget}.`);
    }
    result.defaultTarget = defaultTarget;
  }

  return result;
}

export async function loadConfig(configPath: string, cwd = process.cwd()): Promise<LoadedConfig> {
  const configFile = resolve(cwd, configPath);
  let source: string;

  try {
    source = await readFile(configFile, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    configurationError(`Unable to read configuration file ${configFile}: ${detail}`);
  }

  const document = parseDocument(source, {
    "prettyErrors": true,
    "strict": true,
    "uniqueKeys": true
  });

  if (document.errors.length > 0) {
    configurationError(`Invalid YAML in ${configFile}: ${document.errors[0]?.message ?? "unknown parse error"}`);
  }

  let value: unknown;
  try {
    value = document.toJS({ "maxAliasCount": 0 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    configurationError(`Invalid YAML in ${configFile}: ${detail}`);
  }

  return {
    "config": parseConfiguration(value),
    "configFile": configFile,
    "configDirectory": dirname(configFile)
  };
}
