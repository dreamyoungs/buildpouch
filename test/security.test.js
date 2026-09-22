import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../dist/config/load.js";
import { buildGcloudArguments } from "../dist/providers/gcp-cloud-build.js";
import { parseTrustedSecurityPolicy, verifySecurity } from "../dist/security/verify.js";

const digest = "a".repeat(64);
const image = `registry.example.test/app@sha256:${digest}`;
const now = new Date("2026-09-22T03:00:00Z");
const policy = { "mode": "auto", "scanner": "trivy", "failOnSeverities": ["HIGH", "CRITICAL"], "maxDbAgeHours": 24 };
const protectedPolicy = { "schemaVersion": 1, "environmentClass": "protected", "allowSkip": false };
const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function runner(options = {}) {
  const calls = [];
  const run = async (request) => {
    calls.push(request);
    if (request.args[0] === "image") {
      return {
        "code": options.scanCode ?? 0, "signal": null, "stderr": "",
        "stdout": JSON.stringify({
          "SchemaVersion": 2, "CreatedAt": now.toISOString(), "ArtifactType": "container_image",
          ...(options.server === undefined ? {} : { "Trivy": { "Server": options.server } }),
          "ArtifactName": options.artifactName ?? image,
          "Metadata": { "RepoDigests": options.repoDigests ?? [image] },
          "Results": [{ "Target": "app", "Vulnerabilities": options.vulnerabilities ?? [] }]
        })
      };
    }
    return {
      "code": options.versionCode ?? 0, "signal": null, "stderr": "",
      "stdout": JSON.stringify({
        "Version": "0.70.0", "VulnerabilityDB": {
          "Version": 2,
          "UpdatedAt": options.updatedAt ?? "2026-09-22T02:00:00Z",
          "NextUpdate": options.nextUpdate ?? "2026-09-22T08:00:00Z"
        }
      })
    };
  };
  return { run, calls };
}

test("configuration accepts an optional scan policy and rejects invalid modes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "buildpouch-security-config-"));
  t.after(() => rm(directory, { "recursive": true, "force": true }));
  const config = join(directory, "buildpouch.yaml");
  const base = `schemaVersion: 1\ncontext:\n  name: app\n  root: .\n  entries:\n    - source: app\n      target: app\n`;
  await writeFile(config, base);
  assert.equal((await loadConfig(config)).config.security, undefined);
  await writeFile(config, `${base}security:\n  vulnerabilityScan:\n    mode: auto\n    scanner: trivy\n    failOnSeverities: [HIGH, CRITICAL]\n    maxDbAgeHours: 24\n`);
  assert.equal((await loadConfig(config)).config.security.vulnerabilityScan.mode, "auto");
  await writeFile(config, `${base}security:\n  vulnerabilityScan:\n    mode: maybe\n    scanner: trivy\n    failOnSeverities: [HIGH]\n    maxDbAgeHours: 24\n`);
  await assert.rejects(loadConfig(config), { "code": "INVALID_CONFIGURATION" });
  for (const invalid of [
    "mode: skip\n    scanner: trivy\n    failOnSeverities: [HIGH]\n    maxDbAgeHours: 24",
    "mode: auto\n    scanner: trivy\n    failOnSeverities: [HIGH, HIGH]\n    maxDbAgeHours: 24",
    "mode: auto\n    scanner: trivy\n    failOnSeverities: [HIGH]\n    maxDbAgeHours: 24\n    passed: true"
  ]) {
    await writeFile(config, `${base}security:\n  vulnerabilityScan:\n    ${invalid}\n`);
    await assert.rejects(loadConfig(config), { "code": "INVALID_CONFIGURATION" });
  }
});

test("skip requires a trusted development allowance and retains its reason", async () => {
  const skip = { ...policy, "mode": "skip", "reason": "temporary development exception" };
  await assert.rejects(verifySecurity(skip, protectedPolicy, image), { "code": "SECURITY_SKIP_DENIED" });
  assert.throws(() => parseTrustedSecurityPolicy(JSON.stringify({ ...protectedPolicy, "allowSkip": true })), { "code": "INVALID_CONFIGURATION" });
  const result = await verifySecurity(skip, { ...protectedPolicy, "environmentClass": "development", "allowSkip": true }, image);
  assert.equal(result.status, "SKIPPED");
  assert.equal(result.reason, skip.reason);
});

test("security verify CLI records a permitted development skip", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "buildpouch-security-cli-"));
  t.after(() => rm(directory, { "recursive": true, "force": true }));
  const config = join(directory, "buildpouch.yaml");
  const trusted = join(directory, "runner-policy.json");
  await writeFile(config, `schemaVersion: 1\ncontext:\n  name: app\n  root: .\n  entries:\n    - source: app\n      target: app\nsecurity:\n  vulnerabilityScan:\n    mode: skip\n    scanner: trivy\n    failOnSeverities: [HIGH]\n    maxDbAgeHours: 24\n    reason: development exception\n`);
  await writeFile(trusted, JSON.stringify({ ...protectedPolicy, "environmentClass": "development", "allowSkip": true }));
  const result = spawnSync(process.execPath, [cliPath, "security", "verify", "--config", config,
    "--trusted-policy", trusted, "--image", image, "--json"], { "encoding": "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "SKIPPED");
  await writeFile(trusted, JSON.stringify(protectedPolicy));
  const denied = spawnSync(process.execPath, [cliPath, "security", "verify", "--config", config,
    "--trusted-policy", trusted, "--image", image, "--json"], { "encoding": "utf8" });
  assert.equal(denied.status, 1);
  assert.equal(JSON.parse(denied.stdout).error.code, "SECURITY_SKIP_DENIED");
});

test("auto and always scan the digest instead of reusing a submission claim", async () => {
  for (const mode of ["auto", "always"]) {
    const mock = runner();
    const result = await verifySecurity({ ...policy, mode }, protectedPolicy, image, mock.run, now);
    assert.equal(result.status, "PASS");
    assert.equal(result.scanner.databaseUpdatedAt, "2026-09-22T02:00:00Z");
    assert.equal(mock.calls.length, 2);
    assert.equal(mock.calls[0].args.at(-1), image);
    assert.deepEqual(mock.calls.map((call) => call.args[0]), ["image", "version"]);
  }
});

test("scan fails closed for wrong digest, stale DB, scanner error, and blocking finding", async () => {
  const cases = [
    { "options": { "repoDigests": [] }, "code": "SECURITY_SCAN_FAILED" },
    { "options": { "artifactName": `registry.example.test/other@sha256:${digest}` }, "code": "SECURITY_SCAN_FAILED" },
    { "options": { "updatedAt": "2026-09-20T00:00:00Z" }, "code": "SECURITY_SCAN_FAILED" },
    { "options": { "nextUpdate": "2026-09-22T02:00:00Z" }, "code": "SECURITY_SCAN_FAILED" },
    { "options": { "scanCode": 1 }, "code": "SECURITY_SCAN_FAILED" },
    { "options": { "server": { "Version": "0.70.0" } }, "code": "SECURITY_SCAN_FAILED" },
    { "options": { "vulnerabilities": [{ "Severity": "CRITICAL" }] }, "code": "SECURITY_SCAN_REJECTED" }
  ];
  for (const { options, code } of cases) {
    const mock = runner(options);
    await assert.rejects(verifySecurity(policy, protectedPolicy, image, mock.run, now), { code });
  }
});

test("scan cancellation aborts the runner and returns a cancellation error", async () => {
  const controller = new AbortController();
  await assert.rejects(verifySecurity(policy, protectedPolicy, image, async (request) => {
    assert.equal(request.signal, controller.signal);
    controller.abort();
    throw new Error("aborted");
  }, now, controller.signal), { "code": "USER_CANCELLATION" });
});

test("GCP submission passes policy separately from user substitutions", () => {
  const request = {
    "archive": "/tmp/archive.tar.gz", "contextName": "app", "buildConfig": "/tmp/build.yaml",
    "project": "example-project", "region": "global", "substitutions": { "_APP": "app" }, "scanPolicy": policy
  };
  const args = buildGcloudArguments(request);
  assert.match(args.find((arg) => arg.startsWith("--substitutions=")), /_BUILDPOUCH_SCAN_POLICY/);
  assert.throws(() => buildGcloudArguments({ ...request, "substitutions": { "_BUILDPOUCH_SCAN_POLICY": "fake" } }), { "code": "INVALID_CONFIGURATION" });
});
