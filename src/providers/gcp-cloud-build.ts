/**
 * context archive를 Google Cloud SDK의 Cloud Build 명령에 제출한다.
 *
 * 호출 관계:
 * - 진입: `src/submit.ts`
 * - 협력: 기본 runner는 `src/process/run.ts`를 사용한다.
 *
 * 데이터·부수효과:
 * - 현재 환경의 `gcloud` 인증을 사용해 원격 build를 생성하고 완료까지 기다린다.
 *
 * 실패·보안 경계:
 * - shell 문자열을 만들지 않고 executable과 argument array를 분리한다.
 * - access token이나 service account key를 읽거나 저장하지 않는다.
 */

import { BuildPouchError } from "../errors.js";
import { runProcess } from "../process/run.js";
import type { BuildProvider, ProcessRunner, ProviderBuildResult, ProviderSubmitRequest } from "./types.js";

const remoteFailureStatuses = new Set(["FAILURE", "INTERNAL_ERROR", "TIMEOUT", "CANCELLED", "EXPIRED"]);
const overridableBuiltInSubstitutions = new Set([
  "BRANCH_NAME", "COMMIT_SHA", "REF_NAME", "REPO_FULL_NAME", "REPO_NAME", "REVISION_ID",
  "SERVICE_ACCOUNT_EMAIL", "SHORT_SHA", "TAG_NAME", "TRIGGER_BUILD_CONFIG_PATH", "TRIGGER_NAME"
]);

interface CloudBuildResponse {
  "id"?: unknown;
  "status"?: unknown;
  "createTime"?: unknown;
  "startTime"?: unknown;
  "finishTime"?: unknown;
  "logUrl"?: unknown;
}

function validateProject(project: string): void {
  if (!/^(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|[0-9]{6,})$/.test(project)) {
    throw new BuildPouchError("INVALID_CONFIGURATION", `Invalid Google Cloud project: ${project}.`);
  }
}

function validateRegion(region: string): void {
  if (region !== "global" && !/^[a-z][a-z0-9-]*[a-z0-9]$/.test(region)) {
    throw new BuildPouchError("INVALID_CONFIGURATION", `Invalid Cloud Build region: ${region}.`);
  }
}

function validateSubstitutions(substitutions: Record<string, string>): void {
  const entries = Object.entries(substitutions);
  if (entries.length > 200) {
    throw new BuildPouchError("INVALID_CONFIGURATION", "Cloud Build supports at most 200 substitutions.");
  }

  for (const [key, value] of entries) {
    if (!/^_[A-Z0-9_]+$/.test(key) && !overridableBuiltInSubstitutions.has(key)) {
      throw new BuildPouchError("INVALID_CONFIGURATION", `Invalid Cloud Build substitution key: ${key}.`);
    }
    if (Buffer.byteLength(key) > 100 || Buffer.byteLength(value) > 4000) {
      throw new BuildPouchError("INVALID_CONFIGURATION", `Cloud Build substitution exceeds its size limit: ${key}.`);
    }
  }
}

function encodeSubstitutions(substitutions: Record<string, string>): string | undefined {
  const entries = Object.entries(substitutions).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return undefined;
  }

  const serialized = entries.map(([key, value]) => `${key}=${value}`);
  let delimiterIndex = 0;
  let delimiter = `__BUILDPOUCH_${delimiterIndex}__`;
  while (serialized.some((value) => value.includes(delimiter))) {
    delimiterIndex += 1;
    delimiter = `__BUILDPOUCH_${delimiterIndex}__`;
  }
  return `^${delimiter}^${serialized.join(delimiter)}`;
}

export function buildGcloudArguments(request: ProviderSubmitRequest): string[] {
  validateProject(request.project);
  validateRegion(request.region);
  validateSubstitutions(request.substitutions);
  const encodedSubstitutions = encodeSubstitutions(request.substitutions);

  return [
    "builds",
    "submit",
    request.archive,
    `--project=${request.project}`,
    `--region=${request.region}`,
    `--config=${request.buildConfig}`,
    ...(encodedSubstitutions === undefined ? [] : [`--substitutions=${encodedSubstitutions}`]),
    "--suppress-logs",
    "--quiet",
    "--format=json(id,status,createTime,startTime,finishTime,logUrl)"
  ];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function parseResponse(stdout: string, project: string, elapsedMs: number): ProviderBuildResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new BuildPouchError("PROVIDER_RESPONSE_INVALID", "gcloud returned invalid JSON for the Cloud Build result.");
  }

  const candidate = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new BuildPouchError("PROVIDER_RESPONSE_INVALID", "gcloud returned an unexpected Cloud Build result.");
  }

  const response = candidate as CloudBuildResponse;
  const id = optionalString(response.id);
  const status = optionalString(response.status);
  if (id === undefined || status === undefined) {
    throw new BuildPouchError("PROVIDER_RESPONSE_INVALID", "Cloud Build result is missing id or status.");
  }

  const createTime = optionalString(response.createTime);
  const startTime = optionalString(response.startTime);
  const finishTime = optionalString(response.finishTime);
  const startMilliseconds = startTime === undefined ? Number.NaN : Date.parse(startTime);
  const finishMilliseconds = finishTime === undefined ? Number.NaN : Date.parse(finishTime);
  const remoteDuration = finishMilliseconds - startMilliseconds;
  const durationMs = Number.isFinite(remoteDuration) && remoteDuration >= 0 ? remoteDuration : elapsedMs;
  const url = optionalString(response.logUrl) ?? `https://console.cloud.google.com/cloud-build/builds/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`;

  return {
    id,
    status,
    durationMs,
    url,
    ...(createTime === undefined ? {} : { createTime }),
    ...(startTime === undefined ? {} : { startTime }),
    ...(finishTime === undefined ? {} : { finishTime })
  };
}

function isAuthenticationFailure(stderr: string): boolean {
  return /(active account|auth login|authentication|credentials?|invalid_grant|reauth)/i.test(stderr);
}

function cancellationError(signal?: AbortSignal): BuildPouchError | undefined {
  if (signal?.aborted !== true) {
    return undefined;
  }
  return signal.reason instanceof BuildPouchError
    ? signal.reason
    : new BuildPouchError("USER_CANCELLATION", "Cloud Build submission cancelled by user.", 130);
}

export function createGcpCloudBuildProvider(runner: ProcessRunner = runProcess): BuildProvider {
  return {
    "name": "gcp-cloud-build",
    async submit(request: ProviderSubmitRequest): Promise<ProviderBuildResult> {
      const startedAt = Date.now();
      let processResult;
      try {
        processResult = await runner({
          "executable": "gcloud",
          "args": buildGcloudArguments(request),
          ...(request.signal === undefined ? {} : { "signal": request.signal }),
          ...(request.onStderr === undefined ? {} : { "onStderr": request.onStderr })
        });
      } catch (error) {
        const cancelled = cancellationError(request.signal);
        if (cancelled !== undefined) {
          throw cancelled;
        }
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new BuildPouchError("PROVIDER_NOT_FOUND", "gcloud executable was not found in PATH.");
        }
        throw new BuildPouchError("PROVIDER_SUBMISSION_FAILED", `Unable to run gcloud: ${error instanceof Error ? error.message : String(error)}`);
      }

      const cancelled = cancellationError(request.signal);
      if (cancelled !== undefined) {
        throw cancelled;
      }

      let build: ProviderBuildResult | undefined;
      if (processResult.stdout.trim() !== "") {
        try {
          build = parseResponse(processResult.stdout, request.project, Date.now() - startedAt);
        } catch (error) {
          if (processResult.code === 0) {
            throw error;
          }
        }
      }

      if (build !== undefined && remoteFailureStatuses.has(build.status)) {
        throw new BuildPouchError("REMOTE_BUILD_FAILED", `Cloud Build ${build.id} finished with status ${build.status}. ${build.url}`, 2);
      }
      if (processResult.code !== 0) {
        if (isAuthenticationFailure(processResult.stderr)) {
          throw new BuildPouchError("PROVIDER_AUTHENTICATION_FAILED", "gcloud could not authenticate the Cloud Build request.");
        }
        throw new BuildPouchError("PROVIDER_SUBMISSION_FAILED", `gcloud builds submit exited with code ${processResult.code ?? "unknown"}.`);
      }
      if (build === undefined || build.status !== "SUCCESS") {
        throw new BuildPouchError("PROVIDER_RESPONSE_INVALID", `Cloud Build returned an unexpected final status: ${build?.status ?? "missing"}.`);
      }
      return build;
    }
  };
}
