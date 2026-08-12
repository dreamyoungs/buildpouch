import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const packageMetadata = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function runCli(args = []) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    "encoding": "utf8"
  });
}

test("shows help when invoked without arguments", () => {
  const result = runCli();

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:\n  buildpouch <command>/);
  assert.match(result.stdout, /Commands:/);
  assert.equal(result.stderr, "");
});

test("prints the package version", () => {
  const result = runCli(["--version"]);

  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${packageMetadata.version}\n`);
  assert.equal(result.stderr, "");
});

test("shows help for every implemented command", () => {
  const results = ["inspect", "pack", "submit"].map((command) => runCli([command, "--help"]));

  for (const result of results) {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:\n  buildpouch/);
  }
});

test("fails clearly for an unknown command", () => {
  const result = runCli(["unknown"]);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown command or option: unknown/);
});
