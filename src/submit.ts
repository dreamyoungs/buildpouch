/**
 * submit용 archive 준비, provider 호출과 임시 산출물 정리를 조합한다.
 *
 * 데이터·부수효과:
 * - `--archive`가 없으면 임시 archive를 만들고 제출 종료 후 제거한다.
 * - 기존 archive와 source workspace는 읽기만 한다.
 * - 선택한 provider는 설정에 따라 원격 build와 임시 remote source를 만들 수 있다.
 *
 * 실패·보안 경계:
 * - provider가 참조하는 설정 파일과 archive가 일반 파일인지 확인한다.
 * - provider에는 정규화된 절대 경로와 검증된 설정만 전달하고 secret 값을 준비 출력에 넣지 않는다.
 */

import { chmod, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import type { GcpCloudBuildOptions, LoadedConfig, NcpNksBuildkitOptions } from "./config/types.js";
import { packContext } from "./context/pack.js";
import { BuildPouchError } from "./errors.js";
import { createGcpCloudBuildProvider } from "./providers/gcp-cloud-build.js";
import { createNcpNksBuildkitProvider } from "./providers/ncp-nks-buildkit.js";
import type {
  BuildProvider,
  GcpCloudBuildSubmitRequest,
  NcpNksBuildkitSubmitRequest,
  ProviderBuildResult
} from "./providers/types.js";

export interface PreparedGcpCloudBuildProvider {
  "name": "gcp-cloud-build";
  "target"?: string;
  "project": string;
  "region": string;
  "config": string;
  "substitutions": Record<string, string>;
}

export interface PreparedNcpNksBuildkitProvider {
  "name": "ncp-nks-buildkit";
  "target": string;
  "endpoint": string;
  "region": string;
  "bucket": string;
  "prefix": string;
  "kubeContext": string;
  "namespace": string;
  "jobTemplate": string;
  "container": string;
  "timeoutSeconds": number;
  "pollIntervalSeconds": number;
  "variableNames": string[];
}

export interface PreparedSubmission {
  "context": {
    "name": string;
    "summary"?: {
      "files": number;
      "totalSize": number;
    };
  };
  "archive": {
    "path": string;
    "size": number;
    "temporary": boolean;
  };
  "provider": PreparedGcpCloudBuildProvider | PreparedNcpNksBuildkitProvider;
}

export interface SubmitResult extends PreparedSubmission {
  "schemaVersion": 1;
  "build": ProviderBuildResult;
}

export interface SubmitOptions {
  "cwd": string;
  "archive"?: string;
  "project"?: string;
  "region"?: string;
  "buildConfig"?: string;
  "target"?: string;
  "substitutions": Record<string, string>;
  "signal"?: AbortSignal;
  "onPrepared"?: (submission: PreparedSubmission) => void;
  "onProviderStderr"?: (chunk: string) => void;
  "provider"?: BuildProvider<GcpCloudBuildSubmitRequest> | BuildProvider<NcpNksBuildkitSubmitRequest>;
}

interface SelectedGcpBuild {
  "provider": "gcp-cloud-build";
  "options": GcpCloudBuildOptions;
  "target"?: string;
}

interface SelectedNcpBuild {
  "provider": "ncp-nks-buildkit";
  "options": NcpNksBuildkitOptions;
  "target": string;
}

type SelectedBuild = SelectedGcpBuild | SelectedNcpBuild;

function selectedTarget(name: string, target: LoadedConfig["config"]["targets"][string]): SelectedBuild {
  return { "provider": target.provider, "options": target.options, "target": name } as SelectedBuild;
}

function selectBuild(loaded: LoadedConfig, requestedTarget?: string): SelectedBuild {
  if (requestedTarget !== undefined) {
    const target = loaded.config.targets[requestedTarget];
    if (target === undefined) {
      throw new BuildPouchError("PROVIDER_TARGET_NOT_FOUND", `Unknown build target: ${requestedTarget}.`);
    }
    return selectedTarget(requestedTarget, target);
  }

  if (loaded.config.defaultTarget !== undefined) {
    const name = loaded.config.defaultTarget;
    return selectedTarget(name, loaded.config.targets[name]!);
  }

  if (loaded.config.build !== undefined) {
    return { "provider": "gcp-cloud-build", "options": loaded.config.build };
  }

  const targets = Object.entries(loaded.config.targets);
  if (targets.length === 1) {
    const [name, target] = targets[0]!;
    return selectedTarget(name, target);
  }
  if (targets.length > 1) {
    throw new BuildPouchError("PROVIDER_TARGET_REQUIRED", "submit requires --target or defaultTarget when multiple build targets are configured.");
  }

  throw new BuildPouchError("PROVIDER_NOT_CONFIGURED", "submit requires a build section or at least one named target in the configuration file.");
}

function hasGcpOverrides(options: SubmitOptions): boolean {
  return options.project !== undefined
    || options.region !== undefined
    || options.buildConfig !== undefined
    || Object.keys(options.substitutions).length > 0;
}

async function prepareProvider(loaded: LoadedConfig, selected: SelectedBuild, options: SubmitOptions): Promise<PreparedSubmission["provider"]> {
  if (selected.provider === "gcp-cloud-build") {
    const project = options.project ?? selected.options.project;
    const region = options.region ?? selected.options.region;
    const configuredBuildPath = options.buildConfig === undefined
      ? resolveConfiguredPath(selected.options.config, loaded.configDirectory)
      : resolve(options.cwd, options.buildConfig);
    const buildConfig = await regularFile(configuredBuildPath, "Build configuration");

    return {
      "name": "gcp-cloud-build",
      ...(selected.target === undefined ? {} : { "target": selected.target }),
      "project": project,
      "region": region,
      "config": buildConfig.path,
      "substitutions": { ...selected.options.substitutions, ...options.substitutions }
    };
  }

  if (hasGcpOverrides(options)) {
    throw new BuildPouchError("INVALID_ARGUMENT", "--project, --region, --build-config, and --substitution apply only to gcp-cloud-build targets.");
  }
  const template = await regularFile(resolveConfiguredPath(selected.options.jobTemplate, loaded.configDirectory), "Kubernetes Job template");
  return {
    "name": "ncp-nks-buildkit",
    "target": selected.target,
    "endpoint": selected.options.endpoint,
    "region": selected.options.region,
    "bucket": selected.options.bucket,
    "prefix": selected.options.prefix,
    "kubeContext": selected.options.kubeContext,
    "namespace": selected.options.namespace,
    "jobTemplate": template.path,
    "container": selected.options.container,
    "timeoutSeconds": selected.options.timeoutSeconds,
    "pollIntervalSeconds": selected.options.pollIntervalSeconds,
    "variableNames": Object.keys(selected.options.variables).sort()
  };
}

async function regularFile(path: string, label: string): Promise<{ "path": string; "size": number }> {
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(path);
    const metadata = await stat(resolvedPath);
    if (!metadata.isFile()) {
      throw new BuildPouchError("INVALID_CONFIGURATION", `${label} is not a regular file: ${path}.`);
    }
    return { "path": resolvedPath, "size": metadata.size };
  } catch (error) {
    if (error instanceof BuildPouchError) {
      throw error;
    }
    throw new BuildPouchError("INVALID_CONFIGURATION", `Unable to access ${label.toLowerCase()} ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveConfiguredPath(value: string, configDirectory: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(configDirectory, value);
}

async function cleanupSubmission(directory: string): Promise<void> {
  try {
    await rm(directory, { "recursive": true, "force": true });
  } catch {
    throw new BuildPouchError("SUBMISSION_CLEANUP_FAILED", `Unable to remove temporary submission directory: ${directory}.`);
  }
}

async function createSubmissionDirectory(): Promise<string> {
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "buildpouch-submit-"));
    await chmod(directory, 0o700);
    return directory;
  } catch (error) {
    if (directory !== undefined) {
      try {
        await rm(directory, { "recursive": true, "force": true });
      } catch {
        throw new BuildPouchError("SUBMISSION_CLEANUP_FAILED", `Unable to secure or remove temporary submission directory: ${directory}.`);
      }
    }
    throw new BuildPouchError("CONTEXT_BUILD_FAILED", `Unable to create temporary submission directory: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function submitContext(loaded: LoadedConfig, options: SubmitOptions): Promise<SubmitResult> {
  const selectedBuild = selectBuild(loaded, options.target);
  const preparedProvider = await prepareProvider(loaded, selectedBuild, options);
  let temporaryDirectory: string | undefined;
  let prepared: PreparedSubmission;

  try {
    if (options.archive !== undefined) {
      const archive = await regularFile(resolve(options.cwd, options.archive), "Archive");
      prepared = {
        "context": { "name": loaded.config.context.name },
        "archive": { ...archive, "temporary": false },
        "provider": preparedProvider
      };
    } else {
      temporaryDirectory = await createSubmissionDirectory();
      const packed = await packContext(loaded, {
        "cwd": temporaryDirectory,
        "force": false,
        "keepContext": false,
        ...(options.signal === undefined ? {} : { "signal": options.signal })
      });
      prepared = {
        "context": { "name": loaded.config.context.name, "summary": packed.summary },
        "archive": { ...packed.archive, "temporary": true },
        "provider": preparedProvider
      };
    }

    options.onPrepared?.(prepared);
    let build: ProviderBuildResult;
    if (prepared.provider.name === "gcp-cloud-build" && selectedBuild.provider === "gcp-cloud-build") {
      const provider = options.provider as BuildProvider<GcpCloudBuildSubmitRequest> | undefined ?? createGcpCloudBuildProvider();
      build = await provider.submit({
        "archive": prepared.archive.path,
        "contextName": prepared.context.name,
        ...(prepared.provider.target === undefined ? {} : { "targetName": prepared.provider.target }),
        "buildConfig": prepared.provider.config,
        "project": prepared.provider.project,
        "region": prepared.provider.region,
        "substitutions": prepared.provider.substitutions,
        ...(options.signal === undefined ? {} : { "signal": options.signal }),
        ...(options.onProviderStderr === undefined ? {} : { "onStderr": options.onProviderStderr })
      });
    } else if (prepared.provider.name === "ncp-nks-buildkit" && selectedBuild.provider === "ncp-nks-buildkit") {
      const provider = options.provider as BuildProvider<NcpNksBuildkitSubmitRequest> | undefined ?? createNcpNksBuildkitProvider();
      build = await provider.submit({
        "archive": prepared.archive.path,
        "contextName": prepared.context.name,
        "targetName": prepared.provider.target,
        "endpoint": prepared.provider.endpoint,
        "region": prepared.provider.region,
        "bucket": prepared.provider.bucket,
        "prefix": prepared.provider.prefix,
        ...(selectedBuild.options.awsProfile === undefined ? {} : { "awsProfile": selectedBuild.options.awsProfile }),
        "kubeContext": prepared.provider.kubeContext,
        "namespace": prepared.provider.namespace,
        "jobTemplate": prepared.provider.jobTemplate,
        "container": prepared.provider.container,
        "timeoutSeconds": prepared.provider.timeoutSeconds,
        "pollIntervalSeconds": prepared.provider.pollIntervalSeconds,
        "variables": selectedBuild.options.variables,
        ...(options.signal === undefined ? {} : { "signal": options.signal }),
        ...(options.onProviderStderr === undefined ? {} : { "onStderr": options.onProviderStderr })
      });
    } else {
      throw new BuildPouchError("INVALID_CONFIGURATION", "Selected provider configuration is inconsistent.");
    }

    return { "schemaVersion": 1, ...prepared, build };
  } finally {
    if (temporaryDirectory !== undefined) {
      await cleanupSubmission(temporaryDirectory);
    }
  }
}
