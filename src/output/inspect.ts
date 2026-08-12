/**
 * inspect 결과를 사람용 또는 기계 판독용 문자열로 직렬화한다.
 */

import type { InspectionResult } from "../context/plan.js";

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
    if (value < 1024) {
      break;
    }
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

export function formatInspectionHuman(result: InspectionResult): string {
  const lines = [
    `Context: ${result.context.name}`,
    `Root: ${result.context.root}`,
    `Files: ${result.summary.files}`,
    `Size: ${formatBytes(result.summary.totalSize)}`,
    "",
    ...result.files.map((file) => `${file.source} -> ${file.target} (${formatBytes(file.size)})`)
  ];

  return `${lines.join("\n").trimEnd()}\n`;
}

export function formatInspectionJson(result: InspectionResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
