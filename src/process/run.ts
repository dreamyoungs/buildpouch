/**
 * 외부 실행 파일을 shell 없이 시작하고 구조화된 종료 결과를 수집한다.
 *
 * 데이터·부수효과:
 * - child stdout과 stderr를 메모리에 수집하고 stderr chunk를 선택적으로 전달한다.
 *
 * 실패·보안 경계:
 * - `shell: false`를 고정하며 AbortSignal 취소를 child process에 전달한다.
 */

import { spawn } from "node:child_process";

import type { ProcessRequest, ProcessResult } from "../providers/types.js";

export async function runProcess(request: ProcessRequest): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(request.executable, request.args, {
      "shell": false,
      "signal": request.signal,
      "stdio": ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      request.onStderr?.(chunk);
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ "code": code, "signal": signal, stdout, stderr });
    });
  });
}
