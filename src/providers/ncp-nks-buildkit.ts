/**
 * context archive를 NCP Object Storage에 올리고 NKS의 repository-owned Job을 실행한다.
 *
 * 호출 관계:
 * - 진입: `src/submit.ts`
 * - 협력: `aws` CLI는 S3 호환 Object Storage를, `kubectl`은 기존 NKS context를 사용한다.
 *
 * 데이터·부수효과:
 * - 고유한 임시 object를 업로드하고 Kubernetes Job을 생성해 terminal 상태까지 조회한다.
 * - 성공 또는 확인된 원격 실패 뒤에는 object를 제거한다.
 *
 * 실패·보안 경계:
 * - credential은 읽거나 manifest에 주입하지 않고 각 CLI와 Job의 기존 identity를 사용한다.
 * - Job 접수 여부가 불명확한 로컬 실패나 취소에서는 실행 중인 Job을 깨뜨리지 않도록 object를 보존한다.
 */

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { parseDocument } from "yaml";

import { BuildPouchError } from "../errors.js";
import { runProcess } from "../process/run.js";
import type { BuildProvider, NcpNksBuildkitSubmitRequest, ProcessResult, ProcessRunner, ProviderBuildResult } from "./types.js";

type UnknownRecord = Record<string, unknown>;

interface KubernetesJobState {
  "status": "RUNNING" | "SUCCESS" | "FAILURE";
  "createTime"?: string;
  "startTime"?: string;
  "finishTime"?: string;
  "detail"?: string;
}

interface NcpProviderDependencies {
  "runner"?: ProcessRunner;
  "createId"?: () => string;
  "now"?: () => number;
  "wait"?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

function configurationError(message: string): never {
  throw new BuildPouchError("INVALID_CONFIGURATION", message);
}

function expectRecord(value: unknown, field: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    configurationError(`${field} must be an object.`);
  }
  return value as UnknownRecord;
}

function optionalRecord(value: unknown, field: string): UnknownRecord {
  return value === undefined ? {} : expectRecord(value, field);
}

function responseRecord(value: unknown, field: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BuildPouchError("PROVIDER_RESPONSE_INVALID", `${field} must be an object.`);
  }
  return value as UnknownRecord;
}

function optionalResponseRecord(value: unknown, field: string): UnknownRecord {
  return value === undefined ? {} : responseRecord(value, field);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function safeSegment(value: string): string {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9-]/g, "-").replaceAll(/-+/g, "-").replaceAll(/^-|-$/g, "");
  return normalized === "" ? "context" : normalized;
}

function createJobName(contextName: string, id: string): string {
  const suffix = id.toLowerCase().replaceAll(/[^a-z0-9]/g, "").slice(0, 12) || randomUUID().replaceAll("-", "").slice(0, 12);
  const prefix = `buildpouch-${safeSegment(contextName)}`.slice(0, 50).replaceAll(/-$/g, "");
  return `${prefix}-${suffix}`.slice(0, 63).replaceAll(/-$/g, "");
}

function parseTemplate(source: string, path: string): UnknownRecord {
  const document = parseDocument(source, { "prettyErrors": true, "strict": true, "uniqueKeys": true });
  if (document.errors.length > 0) {
    configurationError(`Invalid Kubernetes Job YAML in ${path}: ${document.errors[0]?.message ?? "unknown parse error"}`);
  }

  let value: unknown;
  try {
    value = document.toJS({ "maxAliasCount": 0 });
  } catch (error) {
    configurationError(`Invalid Kubernetes Job YAML in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return expectRecord(value, "Kubernetes Job template");
}

/**
 * 기존 Job template의 지정 container에 제출 metadata를 환경 변수로 주입한다.
 * template의 command, image, volume, secret과 권한 설정은 수정하지 않는다.
 */
export function prepareNcpJobManifest(source: string, path: string, options: {
  "jobName": string;
  "namespace": string;
  "container": string;
  "environment": Record<string, string>;
}): string {
  const job = parseTemplate(source, path);
  if (job.apiVersion !== "batch/v1" || job.kind !== "Job") {
    configurationError(`${path} must contain a batch/v1 Kubernetes Job.`);
  }

  const metadata = optionalRecord(job.metadata, "Job metadata");
  delete metadata.generateName;
  metadata.name = options.jobName;
  metadata.namespace = options.namespace;
  const labels = optionalRecord(metadata.labels, "Job metadata.labels");
  labels["app.kubernetes.io/created-by"] = "buildpouch";
  metadata.labels = labels;
  job.metadata = metadata;

  const spec = expectRecord(job.spec, "Job spec");
  const podTemplate = expectRecord(spec.template, "Job spec.template");
  const podSpec = expectRecord(podTemplate.spec, "Job spec.template.spec");
  if (!Array.isArray(podSpec.containers)) {
    configurationError("Job spec.template.spec.containers must be an array.");
  }

  const containers = podSpec.containers.map((value, index) => expectRecord(value, `Job container[${index}]`));
  const matches = containers.filter((container) => container.name === options.container);
  if (matches.length !== 1) {
    configurationError(`Job template must contain exactly one container named ${options.container}.`);
  }

  const container = matches[0]!;
  const existingEnvironment = container.env ?? [];
  if (!Array.isArray(existingEnvironment)) {
    configurationError(`Job container ${options.container}.env must be an array.`);
  }
  const injectedNames = new Set(Object.keys(options.environment));
  const preservedEnvironment = existingEnvironment.filter((value, index) => {
    const entry = expectRecord(value, `Job container ${options.container}.env[${index}]`);
    return typeof entry.name !== "string" || !injectedNames.has(entry.name);
  });
  container.env = [
    ...preservedEnvironment,
    ...Object.entries(options.environment)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => ({ "name": name, "value": value }))
  ];

  return JSON.stringify(job);
}

function awsBaseArguments(request: NcpNksBuildkitSubmitRequest): string[] {
  return [
    `--endpoint-url=${request.endpoint}`,
    `--region=${request.region}`,
    ...(request.awsProfile === undefined ? [] : [`--profile=${request.awsProfile}`])
  ];
}

export function buildNcpUploadArguments(request: NcpNksBuildkitSubmitRequest, objectKey: string): string[] {
  return [
    ...awsBaseArguments(request),
    "s3", "cp", request.archive, `s3://${request.bucket}/${objectKey}`,
    "--acl=private", "--only-show-errors", "--no-progress"
  ];
}

export function buildNcpDeleteArguments(request: NcpNksBuildkitSubmitRequest, objectKey: string): string[] {
  return [
    ...awsBaseArguments(request),
    "s3", "rm", `s3://${request.bucket}/${objectKey}`,
    "--only-show-errors"
  ];
}

function kubectlBaseArguments(request: NcpNksBuildkitSubmitRequest): string[] {
  return ["--context", request.kubeContext, "--namespace", request.namespace];
}

export function buildKubectlCreateArguments(request: NcpNksBuildkitSubmitRequest): string[] {
  return [...kubectlBaseArguments(request), "create", "--filename=-", "--output=json"];
}

export function buildKubectlGetArguments(request: NcpNksBuildkitSubmitRequest, jobName: string): string[] {
  return [...kubectlBaseArguments(request), "get", `job/${jobName}`, "--output=json"];
}

function isAuthenticationFailure(stderr: string): boolean {
  return /(credentials?|unable to locate credentials|invalidaccesskeyid|signaturedoesnotmatch|unauthorized|forbidden|authentication|login)/i.test(stderr);
}

function isDefinitiveJobRejection(stderr: string): boolean {
  return /(unauthorized|forbidden|error validating|invalid value|admission webhook.*denied|namespace .* not found|no matches for kind)/i.test(stderr);
}

function cancellationError(signal?: AbortSignal): BuildPouchError | undefined {
  if (signal?.aborted !== true) {
    return undefined;
  }
  return signal.reason instanceof BuildPouchError
    ? signal.reason
    : new BuildPouchError("USER_CANCELLATION", "NCP build submission cancelled by user.", 130);
}

async function execute(runner: ProcessRunner, request: NcpNksBuildkitSubmitRequest, executable: string, args: string[], input?: string): Promise<ProcessResult> {
  try {
    return await runner({
      "executable": executable,
      "args": args,
      ...(input === undefined ? {} : { "input": input }),
      ...(request.signal === undefined ? {} : { "signal": request.signal }),
      ...(request.onStderr === undefined ? {} : { "onStderr": request.onStderr })
    });
  } catch (error) {
    const cancelled = cancellationError(request.signal);
    if (cancelled !== undefined) {
      throw cancelled;
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BuildPouchError("PROVIDER_NOT_FOUND", `${executable} executable was not found in PATH.`);
    }
    throw new BuildPouchError("PROVIDER_SUBMISSION_FAILED", `Unable to run ${executable}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertCommandSucceeded(executable: string, action: string, result: ProcessResult): void {
  if (result.code === 0) {
    return;
  }
  if (isAuthenticationFailure(result.stderr)) {
    throw new BuildPouchError("PROVIDER_AUTHENTICATION_FAILED", `${executable} could not authenticate while ${action}.`);
  }
  throw new BuildPouchError("PROVIDER_SUBMISSION_FAILED", `${executable} exited with code ${result.code ?? "unknown"} while ${action}.`);
}

function parseJobResult(stdout: string, expectedName: string): UnknownRecord {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new BuildPouchError("PROVIDER_RESPONSE_INVALID", "kubectl returned invalid JSON for the NKS Job.");
  }
  const job = responseRecord(value, "NKS Job response");
  const metadata = responseRecord(job.metadata, "NKS Job response metadata");
  if (metadata.name !== expectedName) {
    throw new BuildPouchError("PROVIDER_RESPONSE_INVALID", "kubectl returned an unexpected NKS Job name.");
  }
  return job;
}

function parseJobState(job: UnknownRecord): KubernetesJobState {
  const metadata = responseRecord(job.metadata, "NKS Job metadata");
  const status = optionalResponseRecord(job.status, "NKS Job status");
  const conditions = status.conditions === undefined ? [] : status.conditions;
  if (!Array.isArray(conditions)) {
    throw new BuildPouchError("PROVIDER_RESPONSE_INVALID", "NKS Job status.conditions must be an array.");
  }

  const parsedConditions = conditions.map((value, index) => responseRecord(value, `NKS Job condition[${index}]`));
  const failed = parsedConditions.find((condition) => condition.type === "Failed" && condition.status === "True");
  const complete = parsedConditions.find((condition) => condition.type === "Complete" && condition.status === "True");
  const createTime = optionalString(metadata.creationTimestamp);
  const startTime = optionalString(status.startTime);
  const finishTime = optionalString(status.completionTime) ?? optionalString(failed?.lastTransitionTime) ?? optionalString(complete?.lastTransitionTime);

  if (failed !== undefined) {
    const reason = optionalString(failed.reason);
    const message = optionalString(failed.message);
    return {
      "status": "FAILURE",
      ...(createTime === undefined ? {} : { "createTime": createTime }),
      ...(startTime === undefined ? {} : { "startTime": startTime }),
      ...(finishTime === undefined ? {} : { "finishTime": finishTime }),
      ...(reason === undefined && message === undefined ? {} : { "detail": [reason, message].filter(Boolean).join(": ") })
    };
  }
  if (complete !== undefined || (typeof status.succeeded === "number" && status.succeeded > 0)) {
    return {
      "status": "SUCCESS",
      ...(createTime === undefined ? {} : { "createTime": createTime }),
      ...(startTime === undefined ? {} : { "startTime": startTime }),
      ...(finishTime === undefined ? {} : { "finishTime": finishTime })
    };
  }
  return {
    "status": "RUNNING",
    ...(createTime === undefined ? {} : { "createTime": createTime }),
    ...(startTime === undefined ? {} : { "startTime": startTime })
  };
}

async function archiveSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function durationFromState(state: KubernetesJobState, elapsedMs: number): number {
  const start = state.startTime === undefined ? Number.NaN : Date.parse(state.startTime);
  const finish = state.finishTime === undefined ? Number.NaN : Date.parse(state.finishTime);
  const remoteDuration = finish - start;
  return Number.isFinite(remoteDuration) && remoteDuration >= 0 ? remoteDuration : elapsedMs;
}

async function defaultWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  try {
    await delay(milliseconds, undefined, signal === undefined ? {} : { "signal": signal });
  } catch (error) {
    const cancelled = cancellationError(signal);
    if (cancelled !== undefined) {
      throw cancelled;
    }
    throw error;
  }
}

/**
 * NCP Object Storage 업로드와 NKS Job 상태 확인을 하나의 provider 제출로 수행한다.
 * Job template이 실제 build, Container Registry push와 선택적인 NKS 배포를 소유한다.
 */
export function createNcpNksBuildkitProvider(dependencies: NcpProviderDependencies = {}): BuildProvider<NcpNksBuildkitSubmitRequest> {
  const runner = dependencies.runner ?? runProcess;
  const createId = dependencies.createId ?? randomUUID;
  const now = dependencies.now ?? Date.now;
  const wait = dependencies.wait ?? defaultWait;

  return {
    "name": "ncp-nks-buildkit",
    async submit(request: NcpNksBuildkitSubmitRequest): Promise<ProviderBuildResult> {
      const startedAt = now();
      const submissionId = createId();
      const targetName = request.targetName ?? "default";
      const jobName = createJobName(request.contextName, submissionId);
      const objectKey = `${request.prefix}/${safeSegment(request.contextName)}/${safeSegment(targetName)}/${submissionId}.context.tar.gz`;
      const objectReference = `s3://${request.bucket}/${objectKey}`;
      const archiveMetadata = await stat(request.archive);
      const digest = await archiveSha256(request.archive);
      const templateSource = await readFile(request.jobTemplate, "utf8");
      const manifest = prepareNcpJobManifest(templateSource, request.jobTemplate, {
        "jobName": jobName,
        "namespace": request.namespace,
        "container": request.container,
        "environment": {
          ...request.variables,
          "BUILDPOUCH_CONTEXT_BUCKET": request.bucket,
          "BUILDPOUCH_CONTEXT_ENDPOINT": request.endpoint,
          "BUILDPOUCH_CONTEXT_KEY": objectKey,
          "BUILDPOUCH_CONTEXT_NAME": request.contextName,
          "BUILDPOUCH_CONTEXT_REGION": request.region,
          "BUILDPOUCH_CONTEXT_SHA256": digest,
          "BUILDPOUCH_CONTEXT_SIZE": String(archiveMetadata.size),
          "BUILDPOUCH_SUBMISSION_ID": submissionId,
          "BUILDPOUCH_TARGET": targetName
        }
      });

      const upload = await execute(runner, request, "aws", buildNcpUploadArguments(request, objectKey));
      assertCommandSucceeded("aws", `uploading ${objectReference}`, upload);

      let creationAccepted = false;
      let createdJob: UnknownRecord;
      try {
        const created = await execute(runner, request, "kubectl", buildKubectlCreateArguments(request), manifest);
        if (created.code !== 0) {
          if (!isDefinitiveJobRejection(created.stderr)) {
            creationAccepted = true;
          }
          assertCommandSucceeded("kubectl", `creating NKS Job ${jobName}`, created);
        }
        creationAccepted = true;
        createdJob = parseJobResult(created.stdout, jobName);
      } catch (error) {
        const original = error instanceof BuildPouchError ? error : new BuildPouchError("PROVIDER_SUBMISSION_FAILED", String(error));
        if (!creationAccepted && request.signal?.aborted !== true) {
          try {
            const { signal: _signal, ...cleanupRequest } = request;
            const removed = await execute(runner, cleanupRequest, "aws", buildNcpDeleteArguments(request, objectKey));
            assertCommandSucceeded("aws", `removing ${objectReference}`, removed);
          } catch (cleanupError) {
            throw new BuildPouchError(original.code, `${original.message} Source cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`, original.exitCode);
          }
          throw original;
        }
        throw new BuildPouchError(original.code, `${original.message} Source ${objectReference} was preserved when remote Job state was ambiguous.`, original.exitCode);
      }

      let state = parseJobState(createdJob);
      try {
        while (state.status === "RUNNING") {
          if (now() - startedAt >= request.timeoutSeconds * 1000) {
            throw new BuildPouchError("REMOTE_BUILD_TIMEOUT", `NKS Job ${jobName} did not finish within ${request.timeoutSeconds} seconds.`, 2);
          }
          await wait(request.pollIntervalSeconds * 1000, request.signal);
          if (now() - startedAt >= request.timeoutSeconds * 1000) {
            throw new BuildPouchError("REMOTE_BUILD_TIMEOUT", `NKS Job ${jobName} did not finish within ${request.timeoutSeconds} seconds.`, 2);
          }
          const current = await execute(runner, request, "kubectl", buildKubectlGetArguments(request, jobName));
          assertCommandSucceeded("kubectl", `reading NKS Job ${jobName}`, current);
          state = parseJobState(parseJobResult(current.stdout, jobName));
        }
      } catch (error) {
        const original = error instanceof BuildPouchError ? error : new BuildPouchError("PROVIDER_SUBMISSION_FAILED", String(error));
        throw new BuildPouchError(original.code, `${original.message} NKS Job ${jobName} and source ${objectReference} were preserved.`, original.exitCode);
      }

      let cleanupError: BuildPouchError | undefined;
      try {
        const { signal: _signal, ...cleanupRequest } = request;
        const removed = await execute(runner, cleanupRequest, "aws", buildNcpDeleteArguments(request, objectKey));
        assertCommandSucceeded("aws", `removing ${objectReference}`, removed);
      } catch (error) {
        cleanupError = error instanceof BuildPouchError ? error : new BuildPouchError("PROVIDER_SUBMISSION_FAILED", String(error));
      }

      const reference = `kubernetes://${encodeURIComponent(request.kubeContext)}/${encodeURIComponent(request.namespace)}/jobs/${encodeURIComponent(jobName)}`;
      if (state.status === "FAILURE") {
        if (cleanupError !== undefined) {
          request.onStderr?.(`Warning: ${cleanupError.message}\n`);
        }
        throw new BuildPouchError("REMOTE_BUILD_FAILED", `NKS Job ${jobName} failed${state.detail === undefined ? "" : `: ${state.detail}`}. ${reference}`, 2);
      }
      if (cleanupError !== undefined) {
        throw new BuildPouchError("PROVIDER_CLEANUP_FAILED", `${cleanupError.message} Completed NKS Job: ${reference}`);
      }

      return {
        "id": jobName,
        "status": "SUCCESS",
        "durationMs": durationFromState(state, now() - startedAt),
        "url": reference,
        ...(state.createTime === undefined ? {} : { "createTime": state.createTime }),
        ...(state.startTime === undefined ? {} : { "startTime": state.startTime }),
        ...(state.finishTime === undefined ? {} : { "finishTime": state.finishTime })
      };
    }
  };
}
