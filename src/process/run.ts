/**
 * 외부 실행 파일을 shell 없이 시작하고 구조화된 종료 결과를 수집한다.
 *
 * 데이터·부수효과:
 * - 선택적인 stdin을 전달하고 child stdout과 stderr를 메모리에 수집한다.
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
      "stdio": [request.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const childStdout = child.stdout;
    const childStderr = child.stderr;
    if (childStdout === null || childStderr === null) {
      reject(new Error("Unable to capture child process output."));
      return;
    }

    childStdout.setEncoding("utf8");
    childStderr.setEncoding("utf8");
    childStdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    childStderr.on("data", (chunk: string) => {
      stderr += chunk;
      request.onStderr?.(chunk);
    });
    if (request.input !== undefined) {
      child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") {
          reject(error);
        }
      });
      child.stdin?.end(request.input);
    }
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ "code": code, "signal": signal, stdout, stderr });
    });
  });
}
