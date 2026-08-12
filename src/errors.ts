/**
 * CLI 전 계층에서 사용자에게 노출할 수 있는 오류 코드와 메시지를 정의한다.
 *
 * 호출 관계:
 * - 생성: 설정 로더, context planner, pack·submit 작업, provider, 명령 인자 검증
 * - 소비: `src/cli.ts`가 human 또는 JSON 오류로 출력한다.
 *
 * 실패·보안 경계:
 * - 원본 오류 객체나 stack trace를 공개 출력에 포함하지 않는다.
 */

export type ErrorCode =
  | "ARCHIVE_CREATION_FAILED"
  | "BLOCKED_SECRET"
  | "CONTEXT_BUILD_FAILED"
  | "CONTEXT_CLEANUP_FAILED"
  | "INVALID_ARGUMENT"
  | "INVALID_CONFIGURATION"
  | "MISSING_REQUIRED_SOURCE"
  | "OUTPUT_EXISTS"
  | "PROVIDER_AUTHENTICATION_FAILED"
  | "PROVIDER_CLEANUP_FAILED"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_RESPONSE_INVALID"
  | "PROVIDER_SUBMISSION_FAILED"
  | "PROVIDER_TARGET_NOT_FOUND"
  | "PROVIDER_TARGET_REQUIRED"
  | "REMOTE_BUILD_FAILED"
  | "REMOTE_BUILD_TIMEOUT"
  | "SOURCE_CHANGED"
  | "SUBMISSION_CLEANUP_FAILED"
  | "TARGET_COLLISION"
  | "UNSAFE_PATH"
  | "USER_CANCELLATION";

export class BuildPouchError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;

  constructor(code: ErrorCode, message: string, exitCode = 1) {
    super(message);
    this.name = "BuildPouchError";
    this.code = code;
    this.exitCode = exitCode;
  }
}
