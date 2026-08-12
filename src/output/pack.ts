/**
 * pack 결과를 사람용 또는 기계 판독용 문자열로 직렬화한다.
 */

import type { PackResult } from "../context/pack.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

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

export function formatPackHuman(result: PackResult): string {
  const lines = [
    `Context: ${result.context.name}`,
    `Files: ${result.summary.files}`,
    `Source size: ${formatBytes(result.summary.totalSize)}`,
    `Archive: ${result.archive.path}`,
    `Archive size: ${formatBytes(result.archive.size)}`
  ];
  if (result.context.directory !== undefined) {
    lines.push(`Temporary context kept at: ${result.context.directory}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatPackJson(result: PackResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
