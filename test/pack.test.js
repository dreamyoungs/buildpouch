import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { list } from "tar";

import { loadConfig } from "../dist/config/load.js";
import { packContext } from "../dist/context/pack.js";
import { BuildPouchError } from "../dist/errors.js";

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

async function snapshotWorkspace(workspace) {
  const files = ["app/index.js", "app/start.sh", "app/index.js.map", "unrelated.txt"];
  return Promise.all(files.map(async (file) => {
    const metadata = await stat(join(workspace, file));
    return { "file": file, "contents": await readFile(join(workspace, file), "utf8"), "mode": metadata.mode & 0o777 };
  }));
}

async function createFixture(t) {
  const fixture = await mkdtemp(join(tmpdir(), "buildpouch-pack-test-"));
  const workspace = join(fixture, "workspace");
  const config = join(fixture, "buildpouch.yaml");
  const staging = join(fixture, "staging");
  await mkdir(staging);
  await createFile(join(workspace, "app/index.js"), "console.log('packed');\n");
  await createFile(join(workspace, "app/start.sh"), "#!/bin/sh\nnode index.js\n");
  await chmod(join(workspace, "app/start.sh"), 0o755);
  await createFile(join(workspace, "app/index.js.map"), "map\n");
  await createFile(join(workspace, "unrelated.txt"), "leave me alone\n");
  await writeFile(config, `schemaVersion: 1
context:
  name: sample
  root: ./workspace
  entries:
    - source: app
      target: application
  exclude:
    - "**/*.map"
`);
  t.after(() => rm(fixture, { "recursive": true, "force": true }));

  return { fixture, workspace, config, staging };
}

async function readArchive(archive) {
  const entries = [];
  await list({
    "file": archive,
    "onReadEntry": (entry) => {
      entries.push({ "path": entry.path, "mode": entry.mode });
      entry.resume();
    }
  });
  return entries;
}

test("pack creates only the selected portable archive entries", async (t) => {
  const { fixture, workspace, config, staging } = await createFixture(t);
  const archive = join(fixture, "output.tar.gz");
  const original = await snapshotWorkspace(workspace);

  const result = runCli(["pack", "--config", config, "--output", archive, "--json"], fixture, { "TMPDIR": staging });

  assert.equal(result.status, 0, result.stderr);
  const packed = JSON.parse(result.stdout);
  assert.equal(packed.archive.path, archive);
  assert.equal(packed.summary.files, 2);
  assert.ok(packed.archive.size > 0);
  assert.equal((await stat(archive)).mode & 0o777, 0o600);
  assert.deepEqual((await readArchive(archive)).map((entry) => entry.path), ["application/", "application/index.js", "application/start.sh"]);
  assert.deepEqual(await snapshotWorkspace(workspace), original);
  assert.deepEqual(await readdir(staging), []);
});

test("pack preserves executable permissions", async (t) => {
  const { fixture, config } = await createFixture(t);
  const archive = join(fixture, "output.tar.gz");

  const result = runCli(["pack", "--config", config, "--output", archive], fixture);

  assert.equal(result.status, 0, result.stderr);
  const executable = (await readArchive(archive)).find((entry) => entry.path === "application/start.sh");
  assert.notEqual(executable, undefined);
  assert.equal(executable.mode & 0o111, 0o111);
});

test("pack refuses to replace an archive without --force and cleans staging", async (t) => {
  const { fixture, config, staging } = await createFixture(t);
  const archive = join(fixture, "output.tar.gz");
  await writeFile(archive, "existing\n");

  const result = runCli(["pack", "--config", config, "--output", archive, "--json"], fixture, { "TMPDIR": staging });

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "OUTPUT_EXISTS");
  assert.equal(await readFile(archive, "utf8"), "existing\n");
  assert.deepEqual(await readdir(staging), []);
});

test("pack replaces an existing archive only with --force", async (t) => {
  const { fixture, config } = await createFixture(t);
  const archive = join(fixture, "output.tar.gz");
  await writeFile(archive, "existing\n");

  const result = runCli(["pack", "--config", config, "--output", archive, "--force", "--json"], fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readArchive(archive)).map((entry) => entry.path), ["application/", "application/index.js", "application/start.sh"]);
});

test("pack keeps the staging directory only when requested", async (t) => {
  const { fixture, config, staging } = await createFixture(t);
  const archive = join(fixture, "output.tar.gz");

  const result = runCli(["pack", "--config", config, "--output", archive, "--keep-context", "--json"], fixture, { "TMPDIR": staging });

  assert.equal(result.status, 0, result.stderr);
  const directory = JSON.parse(result.stdout).context.directory;
  assert.equal(await readFile(join(directory, "application/index.js"), "utf8"), "console.log('packed');\n");
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
});

test("pack never overwrites a selected input, even with --force", async (t) => {
  const { fixture, workspace, config } = await createFixture(t);
  const source = join(workspace, "app/index.js");

  const result = runCli(["pack", "--config", config, "--output", source, "--force", "--json"], fixture);

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "UNSAFE_PATH");
  assert.equal(await readFile(source, "utf8"), "console.log('packed');\n");
});

test("pack never overwrites its configuration file, even with --force", async (t) => {
  const { fixture, config } = await createFixture(t);
  const original = await readFile(config, "utf8");

  const result = runCli(["pack", "--config", config, "--output", config, "--force", "--json"], fixture);

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "UNSAFE_PATH");
  assert.equal(await readFile(config, "utf8"), original);
});

test("pack cleans staging when cancelled", async (t) => {
  const { fixture, config, staging } = await createFixture(t);
  const loaded = await loadConfig(config);
  const controller = new AbortController();
  controller.abort(new BuildPouchError("USER_CANCELLATION", "Cancelled for test.", 130));

  await assert.rejects(
    packContext(loaded, {
      "cwd": fixture,
      "force": false,
      "keepContext": false,
      "signal": controller.signal,
      "temporaryDirectory": staging
    }),
    { "code": "USER_CANCELLATION", "exitCode": 130 }
  );
  assert.deepEqual(await readdir(staging), []);
});

test("pack creates a valid empty archive when all optional entries are missing", async (t) => {
  const { fixture, config } = await createFixture(t);
  const archive = join(fixture, "empty.tar.gz");
  await writeFile(config, `schemaVersion: 1
context:
  name: empty
  root: ./workspace
  entries:
    - source: missing.txt
      target: missing.txt
      required: false
`);

  const result = runCli(["pack", "--config", config, "--output", archive, "--json"], fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).summary.files, 0);
  assert.deepEqual(await readArchive(archive), []);
});
