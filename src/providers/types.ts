/**
 * build provider와 외부 process runner 사이의 최소 공개 계약을 정의한다.
 */

export interface ProcessRequest {
  "executable": string;
  "args": string[];
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
  "buildConfig": string;
  "project": string;
  "region": string;
  "substitutions": Record<string, string>;
  "signal"?: AbortSignal;
  "onStderr"?: (chunk: string) => void;
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

export interface BuildProvider {
  readonly name: string;
  submit(request: ProviderSubmitRequest): Promise<ProviderBuildResult>;
}
