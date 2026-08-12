/**
 * submit 준비 정보와 최종 build 결과를 human 또는 JSON 문자열로 직렬화한다.
 */

import type { PreparedSubmission, SubmitResult } from "../submit.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = "B";
  for (const candidate of units) {
    value /= 1024;
    unit = candidate;
    if (value < 1024) break;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds}ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 2 : 1)}s`;
}

export function formatSubmitPreparedHuman(prepared: PreparedSubmission): string {
  const substitutionEntries = Object.entries(prepared.provider.substitutions).sort(([left], [right]) => left.localeCompare(right));
  const lines = [
    `Context: ${prepared.context.name}`,
    ...(prepared.context.summary === undefined ? [] : [
      `Files: ${prepared.context.summary.files}`,
      `Source size: ${formatBytes(prepared.context.summary.totalSize)}`
    ]),
    `Archive: ${prepared.archive.path}${prepared.archive.temporary ? " (temporary)" : ""}`,
    `Archive size: ${formatBytes(prepared.archive.size)}`,
    `Provider: ${prepared.provider.name}`,
    `Project: ${prepared.provider.project}`,
    `Region: ${prepared.provider.region}`,
    `Build config: ${prepared.provider.config}`,
    `Substitutions: ${substitutionEntries.length === 0 ? "none" : substitutionEntries.map(([key, value]) => `${key}=${value}`).join(", ")}`,
    "Submitting build..."
  ];
  return `${lines.join("\n")}\n`;
}

export function formatSubmitResultHuman(result: SubmitResult): string {
  return [
    `Build: ${result.build.id}`,
    `Status: ${result.build.status}`,
    `Duration: ${formatDuration(result.build.durationMs)}`,
    `URL: ${result.build.url}`,
    ...(result.archive.temporary ? ["Temporary archive removed."] : [])
  ].join("\n") + "\n";
}

export function formatSubmitJson(result: SubmitResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
