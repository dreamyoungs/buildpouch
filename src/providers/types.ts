/**
 * build provider와 외부 process runner 사이의 최소 공개 계약을 정의한다.
 */

export interface ProcessRequest {
  "executable": string;
  "args": string[];
  "input"?: string;
  "signal"?: AbortSignal;
  "onStderr"?: (chunk: string) => void;
}

export interface ProcessResult {
  "code": number | null;
  "signal": NodeJS.Signals | null;
  "stdout": string;
  "stderr": string;
}

export type ProcessRunner = (request: ProcessRequest) => Promise<ProcessResult>;

export interface ProviderSubmitRequest {
  "archive": string;
  "contextName": string;
  "targetName"?: string;
  "signal"?: AbortSignal;
  "onStderr"?: (chunk: string) => void;
}

export interface GcpCloudBuildSubmitRequest extends ProviderSubmitRequest {
  "buildConfig": string;
  "project": string;
  "region": string;
  "substitutions": Record<string, string>;
}

export interface NcpNksBuildkitSubmitRequest extends ProviderSubmitRequest {
  "endpoint": string;
  "region": string;
  "bucket": string;
  "prefix": string;
  "awsProfile"?: string;
  "kubeContext": string;
  "namespace": string;
  "jobTemplate": string;
  "container": string;
  "timeoutSeconds": number;
  "pollIntervalSeconds": number;
  "variables": Record<string, string>;
}

export interface ProviderBuildResult {
  "id": string;
  "status": string;
  "durationMs": number;
  "url": string;
  "createTime"?: string;
  "startTime"?: string;
  "finishTime"?: string;
}

export interface BuildProvider<Request extends ProviderSubmitRequest = ProviderSubmitRequest> {
  readonly name: string;
  submit(request: Request): Promise<ProviderBuildResult>;
}
