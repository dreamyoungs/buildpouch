import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function runCli(args, cwd) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    "cwd": cwd,
    "encoding": "utf8"
  });
}

async function createFile(path, contents) {
  await mkdir(dirname(path), { "recursive": true });
  await writeFile(path, contents);
}

async function snapshotTree(root) {
  const paths = (await readdir(root, { "recursive": true })).sort();
  const snapshot = [];

  for (const path of paths) {
    try {
      snapshot.push([path, await readFile(join(root, path), "utf8")]);
    } catch (error) {
      if (error.code !== "EISDIR") {
        throw error;
      }
    }
  }

  return snapshot;
}

async function createFixture(t) {
  const fixture = await mkdtemp(join(tmpdir(), "buildpouch-inspect-"));
  const workspace = join(fixture, "workspace");
  const config = join(fixture, "buildpouch.yaml");
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(fixture, { "recursive": true, "force": true });
  });

  await createFile(join(workspace, "apps/selected-app/index.js"), "selected\n");
  await createFile(join(workspace, "apps/selected-app/index.js.map"), "map\n");
  await createFile(join(workspace, "apps/unrelated-app/index.js"), "unrelated\n");
  await createFile(join(workspace, "packages/used-package/index.js"), "used\n");
  await createFile(join(workspace, "packages/unused-package/index.js"), "unused\n");

  return { fixture, workspace, config };
}

test("inspect reports only selected files without changing the workspace", async (t) => {
  const { fixture, workspace, config } = await createFixture(t);
  await writeFile(config, `schemaVersion: 1
context:
  name: selected-app
  root: ./workspace
  entries:
    - source: apps/selected-app
      target: app
    - source: packages/used-package/*.js
      target: packages/used-package
  exclude:
    - "**/*.map"
`);
  const before = await snapshotTree(workspace);

  const result = runCli(["inspect", "--config", config, "--json"], fixture);

  assert.equal(result.status, 0, result.stderr);
  const inspection = JSON.parse(result.stdout);
  assert.deepEqual(inspection.files.map(({ source, target }) => ({ source, target })), [
    { "source": "apps/selected-app/index.js", "target": "app/index.js" },
    { "source": "packages/used-package/index.js", "target": "packages/used-package/index.js" }
  ]);
  assert.equal(inspection.summary.files, 2);
  assert.equal(inspection.summary.totalSize, 14);
  assert.deepEqual(await snapshotTree(workspace), before);
});

test("inspect prints a concise human-readable file mapping", async (t) => {
  const { fixture, config } = await createFixture(t);
  await writeFile(config, `schemaVersion: 1
context:
  name: selected-app
  root: ./workspace
  entries:
    - source: apps/selected-app/index.js
      target: index.js
`);

  const result = runCli(["inspect", "--config", config], fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Context: selected-app/);
  assert.match(result.stdout, /Files: 1/);
  assert.match(result.stdout, /apps\/selected-app\/index\.js -> index\.js \(9 B\)/);
});

test("inspect ignores a missing optional entry", async (t) => {
  const { fixture, config } = await createFixture(t);
  await writeFile(config, `schemaVersion: 1
context:
  name: optional
  root: ./workspace
  entries:
    - source: missing.txt
      target: missing.txt
      required: false
`);

  const result = runCli(["inspect", "--config", config, "--json"], fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).summary.files, 0);
});

test("inspect rejects a missing required entry", async (t) => {
  const { fixture, config } = await createFixture(t);
  await writeFile(config, `schemaVersion: 1
context:
  name: missing
  root: ./workspace
  entries:
    - source: missing.txt
      target: missing.txt
`);

  const result = runCli(["inspect", "--config", config, "--json"], fixture);

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "MISSING_REQUIRED_SOURCE");
});

test("inspect rejects source and target traversal", async (t) => {
  const { fixture, config } = await createFixture(t);

  for (const [source, target] of [["../outside.txt", "outside.txt"], ["apps/selected-app/index.js", "../index.js"]]) {
    await writeFile(config, `schemaVersion: 1
context:
  name: traversal
  root: ./workspace
  entries:
    - source: ${source}
      target: ${target}
`);
    const result = runCli(["inspect", "--config", config, "--json"], fixture);

    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).error.code, "UNSAFE_PATH");
  }
});

test("inspect rejects symbolic links", async (t) => {
  const { fixture, workspace, config } = await createFixture(t);
  await symlink(join(workspace, "apps/selected-app/index.js"), join(workspace, "apps/selected-app/link.js"));
  await writeFile(config, `schemaVersion: 1
context:
  name: symlink
  root: ./workspace
  entries:
    - source: apps/selected-app/link.js
      target: link.js
`);

  const result = runCli(["inspect", "--config", config, "--json"], fixture);

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "UNSAFE_PATH");
});

test("inspect rejects blocked secret paths", async (t) => {
  const { fixture, workspace, config } = await createFixture(t);
  await createFile(join(workspace, "apps/selected-app/.env"), "SECRET=value\n");
  await writeFile(config, `schemaVersion: 1
context:
  name: secret
  root: ./workspace
  entries:
    - source: apps/selected-app
      target: app
`);

  const result = runCli(["inspect", "--config", config, "--json"], fixture);

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "BLOCKED_SECRET");
});

test("inspect detects case-insensitive target collisions", async (t) => {
  const { fixture, config } = await createFixture(t);
  await writeFile(config, `schemaVersion: 1
context:
  name: collision
  root: ./workspace
  entries:
    - source: apps/selected-app/index.js
      target: App.js
    - source: packages/used-package/index.js
      target: app.js
`);

  const result = runCli(["inspect", "--config", config, "--json"], fixture);

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "TARGET_COLLISION");
});

test("inspect detects file and directory target collisions", async (t) => {
  const { fixture, config } = await createFixture(t);
  await writeFile(config, `schemaVersion: 1
context:
  name: collision
  root: ./workspace
  entries:
    - source: apps/selected-app/index.js
      target: app
    - source: packages/used-package/index.js
      target: app/index.js
`);

  const result = runCli(["inspect", "--config", config, "--json"], fixture);

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "TARGET_COLLISION");
});

test("inspect rejects unknown configuration fields", async (t) => {
  const { fixture, config } = await createFixture(t);
  await writeFile(config, `schemaVersion: 1
context:
  name: invalid
  root: ./workspace
  entires: []
  entries:
    - source: apps/selected-app/index.js
      target: index.js
`);

  const result = runCli(["inspect", "--config", config, "--json"], fixture);

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "INVALID_CONFIGURATION");
});
