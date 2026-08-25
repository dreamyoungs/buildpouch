import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkDependencies } from "../dist/dependencies/check.js";

const oldTime = "2026-01-01T00:00:00.000Z";
const newTime = "2026-08-24T00:00:00.000Z";

function metadata(packages) {
  return async (name) => packages[name];
}

async function fixture(t, files) {
  const directory = await mkdtemp(join(tmpdir(), "buildpouch-dependencies-"));
  t.after(() => rm(directory, { "recursive": true, "force": true }));
  for (const [name, contents] of Object.entries(files)) await writeFile(join(directory, name), contents);
  return directory;
}

function options(lockfile, loadMetadata, extra = {}) {
  return {
    "lockfile": lockfile,
    "minimumReleaseAgeHours": 168,
    "registry": "https://registry.npmjs.org/",
    "allowInstallScripts": new Set(),
    "allowNewPackages": new Set(),
    "allowReleaseAges": new Set(),
    "checkedAt": new Date("2026-08-25T00:00:00.000Z"),
    loadMetadata,
    ...extra
  };
}

test("blocks a newly published transitive npm dependency and reports its path", async (t) => {
  const directory = await fixture(t, {
    "package-lock.json": JSON.stringify({
      "lockfileVersion": 3,
      "packages": {
        "": { "workspaces": ["apps/*"] },
        "apps/api": { "name": "api", "version": "1.0.0", "dependencies": { "parent": "1.0.0" } },
        "node_modules/api": { "resolved": "apps/api", "link": true },
        "node_modules/parent": { "version": "1.0.0", "resolved": "https://registry.npmjs.org/parent/-/parent-1.0.0.tgz", "integrity": "sha512-parent", "dependencies": { "child": "1.0.0" } },
        "node_modules/child": { "version": "1.0.0", "resolved": "https://registry.npmjs.org/child/-/child-1.0.0.tgz", "integrity": "sha512-child" }
      }
    })
  });
  const loadMetadata = metadata({
    "parent": { "time": { "1.0.0": oldTime }, "versions": { "1.0.0": { "dist": { "integrity": "sha512-parent" } } } },
    "child": { "time": { "1.0.0": newTime }, "versions": { "1.0.0": { "dist": { "integrity": "sha512-child" } } } }
  });

  const result = await checkDependencies(options(join(directory, "package-lock.json"), loadMetadata));

  assert.equal(result.ok, false);
  assert.deepEqual(result.violations[0].path, ["parent@1.0.0", "child@1.0.0"]);
  assert.equal(result.violations[0].code, "RELEASE_TOO_NEW");
});

test("detects new pnpm package names and lifecycle scripts against a baseline", async (t) => {
  const baseline = `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      parent: {specifier: 1.0.0, version: 1.0.0}\npackages:\n  parent@1.0.0:\n    resolution: {integrity: sha512-parent}\nsnapshots:\n  parent@1.0.0: {}\n`;
  const current = `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      parent: {specifier: 1.1.0, version: 1.1.0}\npackages:\n  parent@1.1.0:\n    resolution: {integrity: sha512-parent-new}\n  helper@1.0.0:\n    resolution: {integrity: sha512-helper}\nsnapshots:\n  parent@1.1.0:\n    dependencies:\n      helper: 1.0.0\n  helper@1.0.0: {}\n`;
  const directory = await fixture(t, { "baseline.yaml": baseline, "pnpm-lock.yaml": current });
  const loadMetadata = metadata({
    "parent": { "time": { "1.1.0": oldTime }, "versions": { "1.1.0": { "dist": { "integrity": "sha512-parent-new" } } } },
    "helper": { "time": { "1.0.0": oldTime }, "versions": { "1.0.0": { "dist": { "integrity": "sha512-helper" }, "scripts": { "postinstall": "node setup.js" } } } }
  });

  const result = await checkDependencies(options(join(directory, "pnpm-lock.yaml"), loadMetadata, { "baselineLockfile": join(directory, "baseline.yaml") }));

  assert.equal(result.ok, false);
  assert.equal(result.summary.newPackages, 1);
  assert.deepEqual(result.violations.map(({ code, package: selector }) => [code, selector]), [
    ["INSTALL_SCRIPT", "helper@1.0.0"],
    ["NEW_PACKAGE", "helper@1.0.0"]
  ]);
  assert.deepEqual(result.violations[0].path, ["parent@1.1.0", "helper@1.0.0"]);
});

test("accepts exact allowances while still checking registry integrity", async (t) => {
  const lockfile = `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      helper: {specifier: 1.0.0, version: 1.0.0}\npackages:\n  helper@1.0.0:\n    resolution: {integrity: sha512-helper}\nsnapshots:\n  helper@1.0.0: {}\n`;
  const directory = await fixture(t, { "baseline.yaml": `lockfileVersion: '9.0'\nimporters: {.: {}}\npackages: {}\nsnapshots: {}\n`, "pnpm-lock.yaml": lockfile });
  const loadMetadata = metadata({ "helper": { "time": { "1.0.0": newTime }, "versions": { "1.0.0": { "dist": { "integrity": "sha512-helper" }, "scripts": { "install": "node setup.js" } } } } });

  const result = await checkDependencies(options(join(directory, "pnpm-lock.yaml"), loadMetadata, {
    "baselineLockfile": join(directory, "baseline.yaml"),
    "allowInstallScripts": new Set(["helper@1.0.0"]),
    "allowNewPackages": new Set(["helper@1.0.0"]),
    "allowReleaseAges": new Set(["helper@1.0.0"])
  }));

  assert.equal(result.ok, true);
  assert.equal(result.summary.violations, 0);
});
