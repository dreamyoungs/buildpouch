/**
 * 신뢰된 build runner에서 image digest를 직접 검사하고 결과를 판정한다.
 * 제출자가 만든 report 파일은 입력으로 받지 않는다.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { VulnerabilityScanPolicy } from "../config/types.js";
import { BuildPouchError } from "../errors.js";
import { runProcess } from "../process/run.js";
import type { ProcessRunner } from "../providers/types.js";

export interface TrustedSecurityPolicy {
  "schemaVersion": 1;
  "environmentClass": "development" | "protected";
  "allowSkip": boolean;
}

export interface SecurityVerification {
  "schemaVersion": 1;
  "status": "PASS" | "SKIPPED";
  "mode": VulnerabilityScanPolicy["mode"];
  "image": string;
  "policySha256": string;
  "reason"?: string;
  "scanner"?: { "name": "trivy"; "version": string; "databaseUpdatedAt": string; "scannedAt": string };
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BuildPouchError("SECURITY_SCAN_FAILED", `${label} is not an object.`);
  }
  return value as UnknownRecord;
}

function parseJson(value: string, label: string): UnknownRecord {
  try {
    return record(JSON.parse(value), label);
  } catch (error) {
    if (error instanceof BuildPouchError) throw error;
    throw new BuildPouchError("SECURITY_SCAN_FAILED", `${label} is not valid JSON.`);
  }
}

function timestamp(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new BuildPouchError("SECURITY_SCAN_FAILED", `${label} is missing or invalid.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new BuildPouchError("SECURITY_SCAN_FAILED", `${label} is invalid.`);
  return parsed;
}

function scanFailureMessage(stderr: string, phase: "image scan" | "database query"): string {
  let cause = "unknown cause";
  if (/x509:|certificate verify failed|unknown authority/i.test(stderr)) cause = "TLS certificate verification failed";
  else if (/unauthorized|authentication required|access denied|forbidden/i.test(stderr)) cause = "registry authentication failed";
  else if (/timeout|connection refused|no such host|network is unreachable/i.test(stderr)) cause = "network request failed";
  return `Trivy ${phase} failed: ${cause}.`;
}

function trivyEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("TRIVY_")));
}

export function parseTrustedSecurityPolicy(source: string): TrustedSecurityPolicy {
  const policy = parseJson(source, "Trusted security policy");
  const keys = Object.keys(policy);
  if (keys.some((key) => !["schemaVersion", "environmentClass", "allowSkip"].includes(key)) ||
      policy.schemaVersion !== 1 ||
      (policy.environmentClass !== "development" && policy.environmentClass !== "protected") ||
      typeof policy.allowSkip !== "boolean" ||
      (policy.environmentClass === "protected" && policy.allowSkip)) {
    throw new BuildPouchError("INVALID_CONFIGURATION", "Trusted security policy is invalid.");
  }
  return policy as unknown as TrustedSecurityPolicy;
}

export function validateImageReference(image: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:\/-]*@sha256:[a-f0-9]{64}$/.test(image)) {
    throw new BuildPouchError("INVALID_ARGUMENT", "--image requires a repository reference pinned to a sha256 digest.");
  }
}

export async function verifySecurity(
  policy: VulnerabilityScanPolicy,
  trusted: TrustedSecurityPolicy,
  image: string,
  runner: ProcessRunner = runProcess,
  now = new Date(),
  signal?: AbortSignal
): Promise<SecurityVerification> {
  validateImageReference(image);
  if (signal?.aborted) throw new BuildPouchError("USER_CANCELLATION", "Security verification cancelled.", 130);
  const policySha256 = createHash("sha256").update(JSON.stringify(policy)).digest("hex");
  if (policy.mode === "skip") {
    if (trusted.environmentClass !== "development" || !trusted.allowSkip || policy.reason === undefined) {
      throw new BuildPouchError("SECURITY_SKIP_DENIED", "Vulnerability scan skip is not allowed by the trusted runner policy.");
    }
    return { "schemaVersion": 1, "status": "SKIPPED", "mode": "skip", image, policySha256, "reason": policy.reason };
  }

  const directory = await mkdtemp(join(tmpdir(), "buildpouch-scan-"));
  try {
    const env = trivyEnvironment();
    const emptyConfig = join(directory, "trivy.yaml");
    const emptyIgnore = join(directory, "ignore");
    const cache = join(directory, "cache");
    await writeFile(emptyConfig, "{}\n", { "mode": 0o600 });
    await writeFile(emptyIgnore, "", { "mode": 0o600 });
    const scan = await runner({
      "executable": "trivy",
      env,
      "args": ["image", "--config", emptyConfig, "--ignorefile", emptyIgnore, "--cache-dir", cache,
        "--scanners", "vuln", "--severity", "UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL", "--format", "json", "--exit-code", "0", image],
      ...(signal === undefined ? {} : { signal })
    });
    if (scan.code !== 0 || scan.signal !== null) {
      throw new BuildPouchError("SECURITY_SCAN_FAILED", scanFailureMessage(scan.stderr, "image scan"));
    }
    const report = parseJson(scan.stdout, "Trivy image report");
    if (report.Trivy !== undefined && record(report.Trivy, "Trivy report provenance").Server !== undefined) {
      throw new BuildPouchError("SECURITY_SCAN_FAILED", "Trivy client/server reports require server database verification.");
    }
    const metadata = record(report.Metadata, "Trivy image metadata");
    if (report.SchemaVersion !== 2 || report.ArtifactType !== "container_image" || report.ArtifactName !== image ||
        !Array.isArray(metadata.RepoDigests) || !metadata.RepoDigests.includes(image) ||
        !Array.isArray(report.Results) || report.Results.length === 0) {
      throw new BuildPouchError("SECURITY_SCAN_FAILED", "Trivy report does not prove the requested image digest was scanned.");
    }
    const scannedAt = timestamp(report.CreatedAt, "Trivy report creation time");
    if (scannedAt > now.getTime() + 5 * 60_000 || now.getTime() - scannedAt > 60 * 60_000) {
      throw new BuildPouchError("SECURITY_SCAN_FAILED", "Trivy report creation time is outside the current scan window.");
    }
    let blocked = 0;
    for (const resultValue of report.Results) {
      const result = record(resultValue, "Trivy result");
      if (result.Vulnerabilities === undefined) continue;
      if (!Array.isArray(result.Vulnerabilities)) {
        throw new BuildPouchError("SECURITY_SCAN_FAILED", "Trivy vulnerabilities are invalid.");
      }
      for (const vulnerabilityValue of result.Vulnerabilities) {
        const vulnerability = record(vulnerabilityValue, "Trivy vulnerability");
        if (typeof vulnerability.Severity !== "string" || !["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(vulnerability.Severity)) {
          throw new BuildPouchError("SECURITY_SCAN_FAILED", "Trivy vulnerability severity is missing or invalid.");
        }
        if (policy.failOnSeverities.includes(vulnerability.Severity as VulnerabilityScanPolicy["failOnSeverities"][number])) blocked += 1;
      }
    }
    const versionResult = await runner({
      "executable": "trivy",
      env,
      "args": ["version", "--config", emptyConfig, "--cache-dir", cache, "--format", "json"],
      ...(signal === undefined ? {} : { signal })
    });
    if (versionResult.code !== 0 || versionResult.signal !== null) {
      throw new BuildPouchError("SECURITY_SCAN_FAILED", scanFailureMessage(versionResult.stderr, "database query"));
    }
    const version = parseJson(versionResult.stdout, "Trivy version report");
    const database = record(version.VulnerabilityDB, "Trivy vulnerability database metadata");
    const updatedAt = timestamp(database.UpdatedAt, "Trivy database update time");
    const nextUpdate = timestamp(database.NextUpdate, "Trivy database next update time");
    if (typeof version.Version !== "string" || version.Version === "" || !Number.isInteger(database.Version) ||
        updatedAt > now.getTime() || nextUpdate <= now.getTime() ||
        now.getTime() - updatedAt > policy.maxDbAgeHours * 60 * 60_000) {
      throw new BuildPouchError("SECURITY_SCAN_FAILED", "Trivy vulnerability database is missing, stale, or expired.");
    }
    if (blocked > 0) {
      throw new BuildPouchError("SECURITY_SCAN_REJECTED", `Trivy found ${blocked} vulnerabilities at configured blocking severities.`);
    }
    return {
      "schemaVersion": 1, "status": "PASS", "mode": policy.mode, image, policySha256,
      "scanner": { "name": "trivy", "version": version.Version, "databaseUpdatedAt": database.UpdatedAt as string, "scannedAt": report.CreatedAt as string }
    };
  } catch (error) {
    if (signal?.aborted) throw new BuildPouchError("USER_CANCELLATION", "Security verification cancelled.", 130);
    if (error instanceof BuildPouchError) throw error;
    throw new BuildPouchError("SECURITY_SCAN_FAILED", `Unable to run Trivy: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await rm(directory, { "recursive": true, "force": true });
  }
}
