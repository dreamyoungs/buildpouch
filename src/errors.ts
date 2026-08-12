/**
 * CLI 전 계층에서 사용자에게 노출할 수 있는 오류 코드와 메시지를 정의한다.
 *
 * 호출 관계:
 * - 생성: 설정 로더, context planner, 명령 인자 검증
 * - 소비: `src/cli.ts`가 human 또는 JSON 오류로 출력한다.
 *
 * 실패·보안 경계:
 * - 원본 오류 객체나 stack trace를 공개 출력에 포함하지 않는다.
 */

export type ErrorCode =
  | "BLOCKED_SECRET"
  | "INVALID_ARGUMENT"
  | "INVALID_CONFIGURATION"
  | "MISSING_REQUIRED_SOURCE"
  | "TARGET_COLLISION"
  | "UNSAFE_PATH";

export class BuildPouchError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "BuildPouchError";
    this.code = code;
  }
}
