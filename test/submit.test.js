import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, chmod, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildGcloudArguments, createGcpCloudBuildProvider } from "../dist/providers/gcp-cloud-build.js";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function runCli(args, cwd, environment = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    "cwd": cwd,
    "encoding": "utf8",
    "env": { ...process.env, ...environment }
  });
}

async function createFile(path, contents) {
  await mkdir(dirname(path), { "recursive": true });
  await writeFile(path, contents);
}

async function createFixture(t) {
  const fixture = await mkdtemp(join(tmpdir(), "buildpouch-submit-test-"));
  const workspace = join(fixture, "workspace");
  const config = join(fixture, "buildpouch.yaml");
  const buildConfig = join(fixture, "configs/cloud build.yaml");
  const archive = join(fixture, "existing archive.tar.gz");
  const capture = join(fixture, "gcloud-args.json");
  const bin = join(fixture, "bin");
  const gcloud = join(bin, "gcloud");
  await createFile(join(workspace, "app/index.js"), "console.log('submit');\n");
  await createFile(buildConfig, "steps: []\n");
  await createFile(archive, "existing archive\n");
  await createFile(gcloud, `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(process.env.BUILDPOUCH_TEST_CAPTURE, JSON.stringify(process.argv.slice(2)));
const result = {
  id: "build-123",
  status: process.env.BUILDPOUCH_TEST_MODE === "remote-failure" ? "FAILURE" : "SUCCESS",
  createTime: "2026-08-12T00:00:00.000Z",
  startTime: "2026-08-12T00:00:01.000Z",
  finishTime: "2026-08-12T00:00:06.000Z",
  logUrl: "https://console.cloud.google.com/cloud-build/builds/build-123?project=example-project"
};
if (process.env.BUILDPOUCH_TEST_MODE === "authentication-failure") {
  process.stderr.write("You do not currently have an active account selected. Run gcloud auth login.\\n");
  process.exitCode = 1;
} else if (process.env.BUILDPOUCH_TEST_MODE === "invalid-json") {
  process.stdout.write("not json\\n");
} else if (process.env.BUILDPOUCH_TEST_MODE === "wait") {
  setInterval(() => {}, 1000);
} else {
  process.stderr.write("gcloud diagnostic\\n");
  process.stdout.write(JSON.stringify(result));
  if (result.status !== "SUCCESS") process.exitCode = 1;
}
`);
  await chmod(gcloud, 0o755);
  await writeFile(config, `schemaVersion: 1
context:
  name: sample
  root: ./workspace
  entries:
    - source: app
      target: app
build:
  provider: gcp-cloud-build
  config: "configs/cloud build.yaml"
  project: example-project
  region: asia-northeast3
  substitutions:
    _APP_NAME: configured
`);
  t.after(() => rm(fixture, { "recursive": true, "force": true }));

  return { fixture, config, buildConfig, archive, capture, bin };
}

function fixtureEnvironment(fixture, mode = "success") {
  return {
    "PATH": `${fixture.bin}:${process.env.PATH ?? ""}`,
    "BUILDPOUCH_TEST_CAPTURE": fixture.capture,
    "BUILDPOUCH_TEST_MODE": mode
  };
}

async function waitForFile(path) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await delay(20);
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

test("GCP provider uses a gcloud argument array and parses the final build", async () => {
  let captured;
  const provider = createGcpCloudBuildProvider(async (request) => {
    captured = request;
    return {
      "code": 0,
      "signal": null,
      "stderr": "",
      "stdout": JSON.stringify({
        "id": "build-123",
        "status": "SUCCESS",
        "startTime": "2026-08-12T00:00:01.000Z",
        "finishTime": "2026-08-12T00:00:06.000Z",
        "logUrl": "https://example.test/build-123"
      })
    };
  });
  const request = {
    "archive": "/tmp/archive with spaces.tar.gz",
    "buildConfig": "/tmp/cloud build.yaml",
    "project": "example-project",
    "region": "asia-northeast3",
    "substitutions": { "_MESSAGE": "hello,world=ok", "_APP_NAME": "sample" }
  };

  const result = await provider.submit(request);

  assert.equal(captured.executable, "gcloud");
  assert.deepEqual(captured.args, buildGcloudArguments(request));
  assert.equal(captured.args[2], request.archive);
  assert.equal(captured.args[5], `--config=${request.buildConfig}`);
  assert.match(captured.args[6], /^--substitutions=\^__BUILDPOUCH_0__\^_APP_NAME=sample/);
  assert.match(captured.args[6], /_MESSAGE=hello,world=ok$/);
  assert.equal(result.durationMs, 5000);
  assert.equal(result.status, "SUCCESS");
});

test("submit preserves an existing archive and applies CLI overrides", async (t) => {
  const fixture = await createFixture(t);
  const result = runCli([
    "submit", "--config", fixture.config, "--archive", fixture.archive,
    "--project", "override-project", "--region", "us-central1",
    "--substitution", "_APP_NAME=override", "--substitution", "_MESSAGE=hello,world", "--json"
  ], fixture.fixture, fixtureEnvironment(fixture));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /gcloud diagnostic/);
  const submitted = JSON.parse(result.stdout);
  const args = JSON.parse(await readFile(fixture.capture, "utf8"));
  assert.equal(submitted.archive.temporary, false);
  assert.equal(submitted.provider.project, "override-project");
  assert.equal(submitted.provider.region, "us-central1");
  assert.equal(submitted.provider.substitutions._APP_NAME, "override");
  assert.equal(args[2], await realpath(fixture.archive));
  assert.equal(args[5], `--config=${await realpath(fixture.buildConfig)}`);
  assert.match(args[6], /_APP_NAME=override/);
  assert.match(args[6], /_MESSAGE=hello,world/);
  assert.equal(await readFile(fixture.archive, "utf8"), "existing archive\n");
});

test("submit packs and removes its internal temporary archive", async (t) => {
  const fixture = await createFixture(t);

  const result = runCli(["submit", "--config", fixture.config, "--json"], fixture.fixture, fixtureEnvironment(fixture));

  assert.equal(result.status, 0, result.stderr);
  const submitted = JSON.parse(result.stdout);
  const args = JSON.parse(await readFile(fixture.capture, "utf8"));
  assert.equal(submitted.context.summary.files, 1);
  assert.equal(submitted.archive.temporary, true);
  assert.equal(args[2], submitted.archive.path);
  await assert.rejects(access(submitted.archive.path), { "code": "ENOENT" });
});

test("submit distinguishes a remote build failure", async (t) => {
  const fixture = await createFixture(t);

  const result = runCli(["submit", "--config", fixture.config, "--archive", fixture.archive, "--json"], fixture.fixture, fixtureEnvironment(fixture, "remote-failure"));

  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).error.code, "REMOTE_BUILD_FAILED");
  assert.match(result.stderr, /gcloud diagnostic/);
  assert.equal(await readFile(fixture.archive, "utf8"), "existing archive\n");
});

test("submit distinguishes a provider authentication failure", async (t) => {
  const fixture = await createFixture(t);

  const result = runCli(["submit", "--config", fixture.config, "--archive", fixture.archive, "--json"], fixture.fixture, fixtureEnvironment(fixture, "authentication-failure"));

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "PROVIDER_AUTHENTICATION_FAILED");
  assert.match(result.stderr, /active account/);
});

test("submit rejects an invalid successful provider response", async (t) => {
  const fixture = await createFixture(t);

  const result = runCli(["submit", "--config", fixture.config, "--archive", fixture.archive, "--json"], fixture.fixture, fixtureEnvironment(fixture, "invalid-json"));

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "PROVIDER_RESPONSE_INVALID");
});

test("submit reports when gcloud is not installed", async () => {
  const error = Object.assign(new Error("spawn gcloud ENOENT"), { "code": "ENOENT" });
  const provider = createGcpCloudBuildProvider(async () => { throw error; });

  await assert.rejects(provider.submit({
    "archive": "/tmp/archive.tar.gz",
    "buildConfig": "/tmp/cloudbuild.yaml",
    "project": "example-project",
    "region": "global",
    "substitutions": {}
  }), { "code": "PROVIDER_NOT_FOUND" });
});

test("submit requires provider configuration", async (t) => {
  const fixture = await createFixture(t);
  await writeFile(fixture.config, `schemaVersion: 1
context:
  name: sample
  root: ./workspace
  entries:
    - source: app
      target: app
`);

  const result = runCli(["submit", "--config", fixture.config, "--archive", fixture.archive, "--json"], fixture.fixture, fixtureEnvironment(fixture));

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "PROVIDER_NOT_CONFIGURED");
  await assert.rejects(access(fixture.capture), { "code": "ENOENT" });
});

test("submit cancellation stops gcloud and removes the internal archive", async (t) => {
  const fixture = await createFixture(t);
  const child = spawn(process.execPath, [cliPath, "submit", "--config", fixture.config, "--json"], {
    "cwd": fixture.fixture,
    "env": { ...process.env, ...fixtureEnvironment(fixture, "wait") },
    "stdio": ["ignore", "pipe", "pipe"]
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const completion = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  const args = JSON.parse(await waitForFile(fixture.capture));

  child.kill("SIGINT");
  const exit = await completion;

  assert.equal(exit.signal, null, stderr);
  assert.equal(exit.code, 130, stderr);
  assert.equal(JSON.parse(stdout).error.code, "USER_CANCELLATION");
  await assert.rejects(access(args[2]), { "code": "ENOENT" });
});
