import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  buildKubectlCreateArguments,
  buildKubectlGetArguments,
  buildNcpDeleteArguments,
  buildNcpUploadArguments,
  createNcpNksBuildkitProvider,
  prepareNcpJobManifest
} from "../dist/providers/ncp-nks-buildkit.js";
import { loadConfig } from "../dist/config/load.js";
import { runProcess } from "../dist/process/run.js";
import { submitContext } from "../dist/submit.js";

async function createFile(path, contents) {
  await mkdir(dirname(path), { "recursive": true });
  await writeFile(path, contents);
}

async function createFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "buildpouch-ncp-test-"));
  const archive = join(directory, "archive.tar.gz");
  const jobTemplate = join(directory, "job.yaml");
  await createFile(archive, "archive contents\n");
  await createFile(jobTemplate, `apiVersion: batch/v1
kind: Job
metadata:
  generateName: ignored-
  labels:
    example: test
spec:
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: buildpouch
          image: example.test/buildpouch-runner:v1
          env:
            - name: EXISTING
              value: kept
`);
  t.after(() => rm(directory, { "recursive": true, "force": true }));
  return { "archive": archive, "jobTemplate": jobTemplate };
}

function createRequest(fixture, overrides = {}) {
  return {
    "archive": fixture.archive,
    "contextName": "customer-api",
    "targetName": "ncp-development",
    "endpoint": "https://kr.object.ncloudstorage.com",
    "region": "kr-standard",
    "bucket": "build-contexts",
    "prefix": "buildpouch",
    "awsProfile": "ncp",
    "kubeContext": "nks-development",
    "namespace": "build-system",
    "jobTemplate": fixture.jobTemplate,
    "container": "buildpouch",
    "timeoutSeconds": 120,
    "pollIntervalSeconds": 1,
    "variables": { "IMAGE_REF": "registry.example.test/customer-api:test" },
    ...overrides
  };
}

function jobResponse(name, status = {}) {
  return JSON.stringify({
    "apiVersion": "batch/v1",
    "kind": "Job",
    "metadata": {
      "name": name,
      "namespace": "build-system",
      "creationTimestamp": "2026-08-12T00:00:00.000Z"
    },
    status
  });
}

test("NCP command builders keep endpoints, paths, and contexts as argument arrays", async (t) => {
  const fixture = await createFixture(t);
  const request = createRequest(fixture);
  const key = "buildpouch/customer-api/development/id.context.tar.gz";

  assert.deepEqual(buildNcpUploadArguments(request, key), [
    "--endpoint-url=https://kr.object.ncloudstorage.com",
    "--region=kr-standard",
    "--profile=ncp",
    "s3", "cp", fixture.archive, `s3://build-contexts/${key}`,
    "--acl=private", "--only-show-errors", "--no-progress"
  ]);
  assert.deepEqual(buildNcpDeleteArguments(request, key), [
    "--endpoint-url=https://kr.object.ncloudstorage.com",
    "--region=kr-standard",
    "--profile=ncp",
    "s3", "rm", `s3://build-contexts/${key}`,
    "--only-show-errors"
  ]);
  assert.deepEqual(buildKubectlCreateArguments(request), [
    "--context", "nks-development", "--namespace", "build-system",
    "create", "--filename=-", "--output=json"
  ]);
  assert.deepEqual(buildKubectlGetArguments(request, "buildpouch-job"), [
    "--context", "nks-development", "--namespace", "build-system",
    "get", "job/buildpouch-job", "--output=json"
  ]);
});

test("NCP manifest injection preserves the runner template and replaces reserved metadata", async (t) => {
  const fixture = await createFixture(t);
  const source = await (await import("node:fs/promises")).readFile(fixture.jobTemplate, "utf8");
  const manifest = JSON.parse(prepareNcpJobManifest(source, fixture.jobTemplate, {
    "jobName": "buildpouch-customer-api-fixed",
    "namespace": "build-system",
    "container": "buildpouch",
    "environment": {
      "BUILDPOUCH_CONTEXT_KEY": "buildpouch/context/id.tar.gz",
      "IMAGE_REF": "registry.example.test/customer-api:test"
    }
  }));

  assert.equal(manifest.metadata.name, "buildpouch-customer-api-fixed");
  assert.equal(manifest.metadata.namespace, "build-system");
  assert.equal(manifest.metadata.generateName, undefined);
  assert.equal(manifest.metadata.labels.example, "test");
  assert.equal(manifest.metadata.labels["app.kubernetes.io/created-by"], "buildpouch");
  assert.equal(manifest.spec.ttlSecondsAfterFinished, 600);
  assert.deepEqual(manifest.spec.template.spec.containers[0].env, [
    { "name": "EXISTING", "value": "kept" },
    { "name": "BUILDPOUCH_CONTEXT_KEY", "value": "buildpouch/context/id.tar.gz" },
    { "name": "IMAGE_REF", "value": "registry.example.test/customer-api:test" }
  ]);
});

test("NCP provider uploads, creates, polls, and removes a terminal source object", async (t) => {
  const fixture = await createFixture(t);
  const calls = [];
  const runner = async (request) => {
    calls.push(request);
    if (request.executable === "aws") {
      return { "code": 0, "signal": null, "stdout": "", "stderr": "" };
    }
    if (request.args.includes("create")) {
      const manifest = JSON.parse(request.input);
      return {
        "code": 0,
        "signal": null,
        "stdout": jobResponse(manifest.metadata.name, { "startTime": "2026-08-12T00:00:01.000Z" }),
        "stderr": ""
      };
    }
    const name = request.args.find((value) => value.startsWith("job/")).slice(4);
    return {
      "code": 0,
      "signal": null,
      "stdout": jobResponse(name, {
        "startTime": "2026-08-12T00:00:01.000Z",
        "completionTime": "2026-08-12T00:00:06.000Z",
        "succeeded": 1,
        "conditions": [{ "type": "Complete", "status": "True", "lastTransitionTime": "2026-08-12T00:00:06.000Z" }]
      }),
      "stderr": ""
    };
  };
  const provider = createNcpNksBuildkitProvider({
    "runner": runner,
    "createId": () => "01234567-89ab-cdef-0123-456789abcdef",
    "wait": async () => {}
  });

  const result = await provider.submit(createRequest(fixture));

  assert.equal(result.id, "buildpouch-customer-api-0123456789ab");
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.durationMs, 5000);
  assert.equal(result.url, "kubernetes://nks-development/build-system/jobs/buildpouch-customer-api-0123456789ab");
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((call) => [call.executable, call.args.includes("cp") ? "upload" : call.args.includes("create") ? "create" : call.args.includes("get") ? "get" : "delete"]), [
    ["aws", "upload"],
    ["kubectl", "create"],
    ["kubectl", "get"],
    ["aws", "delete"]
  ]);
  const manifest = JSON.parse(calls[1].input);
  const environment = Object.fromEntries(manifest.spec.template.spec.containers[0].env.map(({ name, value }) => [name, value]));
  assert.equal(environment.BUILDPOUCH_CONTEXT_BUCKET, "build-contexts");
  assert.equal(environment.BUILDPOUCH_CONTEXT_KEY, "buildpouch/customer-api/ncp-development/01234567-89ab-cdef-0123-456789abcdef.context.tar.gz");
  assert.equal(environment.BUILDPOUCH_CONTEXT_SHA256.length, 64);
  assert.equal(environment.IMAGE_REF, "registry.example.test/customer-api:test");
});

test("NCP provider removes the source after a confirmed remote failure", async (t) => {
  const fixture = await createFixture(t);
  const calls = [];
  const runner = async (request) => {
    calls.push(request);
    if (request.executable === "aws") return { "code": 0, "signal": null, "stdout": "", "stderr": "" };
    const manifest = JSON.parse(request.input);
    return {
      "code": 0,
      "signal": null,
      "stdout": jobResponse(manifest.metadata.name, {
        "conditions": [{ "type": "Failed", "status": "True", "reason": "BackoffLimitExceeded" }]
      }),
      "stderr": ""
    };
  };
  const provider = createNcpNksBuildkitProvider({ "runner": runner, "createId": () => "failure-id", "wait": async () => {} });

  await assert.rejects(provider.submit(createRequest(fixture)), { "code": "REMOTE_BUILD_FAILED", "exitCode": 2 });
  assert.equal(calls.at(-1).executable, "aws");
  assert.ok(calls.at(-1).args.includes("rm"));
});

test("NCP provider removes the uploaded source when Job creation is definitively rejected", async (t) => {
  const fixture = await createFixture(t);
  const calls = [];
  const runner = async (request) => {
    calls.push(request);
    if (request.executable === "kubectl") {
      return { "code": 1, "signal": null, "stdout": "", "stderr": "forbidden" };
    }
    return { "code": 0, "signal": null, "stdout": "", "stderr": "" };
  };
  const provider = createNcpNksBuildkitProvider({ "runner": runner, "createId": () => "rejected-id", "wait": async () => {} });

  await assert.rejects(provider.submit(createRequest(fixture)), { "code": "PROVIDER_AUTHENTICATION_FAILED" });
  assert.equal(calls.length, 3);
  assert.ok(calls.at(-1).args.includes("rm"));
});

test("NCP provider preserves the source when Job creation result is ambiguous", async (t) => {
  const fixture = await createFixture(t);
  const calls = [];
  const runner = async (request) => {
    calls.push(request);
    if (request.executable === "aws") {
      return { "code": 0, "signal": null, "stdout": "", "stderr": "" };
    }
    return { "code": 1, "signal": null, "stdout": "", "stderr": "Unable to connect to the server: i/o timeout" };
  };
  const provider = createNcpNksBuildkitProvider({ "runner": runner, "createId": () => "ambiguous-create-id", "wait": async () => {} });

  await assert.rejects(provider.submit(createRequest(fixture)), (error) => {
    assert.equal(error.code, "PROVIDER_SUBMISSION_FAILED");
    assert.match(error.message, /preserved when remote Job state was ambiguous/);
    return true;
  });
  assert.equal(calls.length, 2);
  assert.equal(calls.filter((call) => call.args.includes("rm")).length, 0);
});

test("NCP provider preserves the Job and source when polling becomes ambiguous", async (t) => {
  const fixture = await createFixture(t);
  const calls = [];
  const runner = async (request) => {
    calls.push(request);
    if (request.executable === "aws") return { "code": 0, "signal": null, "stdout": "", "stderr": "" };
    if (request.args.includes("create")) {
      const manifest = JSON.parse(request.input);
      return { "code": 0, "signal": null, "stdout": jobResponse(manifest.metadata.name), "stderr": "" };
    }
    return { "code": 1, "signal": null, "stdout": "", "stderr": "network timeout" };
  };
  const provider = createNcpNksBuildkitProvider({ "runner": runner, "createId": () => "ambiguous-id", "wait": async () => {} });

  await assert.rejects(provider.submit(createRequest(fixture)), (error) => {
    assert.equal(error.code, "PROVIDER_SUBMISSION_FAILED");
    assert.match(error.message, /were preserved/);
    return true;
  });
  assert.equal(calls.length, 3);
  assert.equal(calls.filter((call) => call.args.includes("rm")).length, 0);
});

test("NCP provider reports timeout and preserves an accepted Job source", async (t) => {
  const fixture = await createFixture(t);
  const calls = [];
  let clock = 0;
  const runner = async (request) => {
    calls.push(request);
    if (request.executable === "aws") return { "code": 0, "signal": null, "stdout": "", "stderr": "" };
    const manifest = JSON.parse(request.input);
    return { "code": 0, "signal": null, "stdout": jobResponse(manifest.metadata.name), "stderr": "" };
  };
  const provider = createNcpNksBuildkitProvider({
    "runner": runner,
    "createId": () => "timeout-id",
    "now": () => clock,
    "wait": async () => { clock = 2000; }
  });

  await assert.rejects(provider.submit(createRequest(fixture, { "timeoutSeconds": 1 })), (error) => {
    assert.equal(error.code, "REMOTE_BUILD_TIMEOUT");
    assert.equal(error.exitCode, 2);
    assert.match(error.message, /were preserved/);
    return true;
  });
  assert.equal(calls.filter((call) => call.args.includes("rm")).length, 0);
});

test("NCP provider reports a missing AWS CLI", async (t) => {
  const fixture = await createFixture(t);
  const error = Object.assign(new Error("spawn aws ENOENT"), { "code": "ENOENT" });
  const provider = createNcpNksBuildkitProvider({
    "runner": async () => { throw error; },
    "createId": () => "missing-tool-id"
  });

  await assert.rejects(provider.submit(createRequest(fixture)), { "code": "PROVIDER_NOT_FOUND" });
});

test("submit loads an NCP target and passes resolved nonsecret settings to its provider", async (t) => {
  const fixture = await createFixture(t);
  const directory = dirname(fixture.jobTemplate);
  const workspace = join(directory, "workspace");
  const config = join(directory, "buildpouch.yaml");
  await createFile(join(workspace, "app/index.js"), "console.log('ncp');\n");
  await createFile(config, `schemaVersion: 1
context:
  name: customer-api
  root: ./workspace
  entries:
    - source: app
      target: app
defaultTarget: ncp-development
targets:
  ncp-development:
    provider: ncp-nks-buildkit
    options:
      endpoint: https://kr.object.ncloudstorage.com
      region: kr-standard
      bucket: build-contexts
      prefix: contexts/development
      awsProfile: ncp
      kubeContext: nks-development
      namespace: build-system
      jobTemplate: job.yaml
      container: buildpouch
      timeoutSeconds: 600
      pollIntervalSeconds: 2
      variables:
        IMAGE_REF: registry.example.test/customer-api:test
`);
  const loaded = await loadConfig(config);
  let captured;
  const provider = {
    "name": "ncp-nks-buildkit",
    async submit(request) {
      captured = request;
      return { "id": "job-1", "status": "SUCCESS", "durationMs": 10, "url": "kubernetes://job-1" };
    }
  };

  const result = await submitContext(loaded, {
    "cwd": directory,
    "archive": fixture.archive,
    "substitutions": {},
    provider
  });

  assert.equal(result.provider.name, "ncp-nks-buildkit");
  assert.equal(result.provider.target, "ncp-development");
  assert.equal(result.provider.jobTemplate, await realpath(fixture.jobTemplate));
  assert.deepEqual(result.provider.variableNames, ["IMAGE_REF"]);
  assert.equal(result.provider.awsProfile, undefined);
  assert.equal(result.provider.variables, undefined);
  assert.equal(captured.awsProfile, "ncp");
  assert.equal(captured.jobTemplate, await realpath(fixture.jobTemplate));
  assert.equal(captured.variables.IMAGE_REF, "registry.example.test/customer-api:test");
});

test("NCP targets reject GCP-only CLI overrides", async (t) => {
  const fixture = await createFixture(t);
  const directory = dirname(fixture.jobTemplate);
  const workspace = join(directory, "workspace");
  const config = join(directory, "buildpouch.yaml");
  await createFile(join(workspace, "app/index.js"), "console.log('ncp');\n");
  await createFile(config, `schemaVersion: 1
context:
  name: customer-api
  root: ./workspace
  entries:
    - source: app
      target: app
targets:
  ncp:
    provider: ncp-nks-buildkit
    options:
      endpoint: https://kr.object.ncloudstorage.com
      region: kr-standard
      bucket: build-contexts
      kubeContext: nks-development
      namespace: build-system
      jobTemplate: job.yaml
`);
  const loaded = await loadConfig(config);

  await assert.rejects(submitContext(loaded, {
    "cwd": directory,
    "archive": fixture.archive,
    "project": "gcp-project",
    "substitutions": {}
  }), { "code": "INVALID_ARGUMENT" });
});

test("NCP configuration rejects attempts to override reserved Job metadata", async (t) => {
  const fixture = await createFixture(t);
  const directory = dirname(fixture.jobTemplate);
  const workspace = join(directory, "workspace");
  const config = join(directory, "buildpouch.yaml");
  await createFile(join(workspace, "app/index.js"), "console.log('ncp');\n");
  await createFile(config, `schemaVersion: 1
context:
  name: customer-api
  root: ./workspace
  entries:
    - source: app
      target: app
targets:
  ncp:
    provider: ncp-nks-buildkit
    options:
      endpoint: https://kr.object.ncloudstorage.com
      region: kr-standard
      bucket: build-contexts
      kubeContext: nks-development
      namespace: build-system
      jobTemplate: job.yaml
      variables:
        BUILDPOUCH_CONTEXT_KEY: overridden
`);

  await assert.rejects(loadConfig(config), { "code": "INVALID_CONFIGURATION" });
});

test("BuildPouch configuration accepts JSON syntax", async (t) => {
  const fixture = await createFixture(t);
  const directory = dirname(fixture.jobTemplate);
  const workspace = join(directory, "workspace");
  const config = join(directory, "buildpouch.json");
  await createFile(join(workspace, "app/index.js"), "console.log('json');\n");
  await writeFile(config, JSON.stringify({
    "schemaVersion": 1,
    "context": {
      "name": "customer-api",
      "root": "./workspace",
      "entries": [{ "source": "app", "target": "app" }]
    },
    "targets": {
      "ncp": {
        "provider": "ncp-nks-buildkit",
        "options": {
          "endpoint": "https://kr.object.ncloudstorage.com",
          "region": "kr-standard",
          "bucket": "build-contexts",
          "kubeContext": "nks-development",
          "namespace": "build-system",
          "jobTemplate": "job.yaml"
        }
      }
    }
  }));

  const loaded = await loadConfig(config);

  assert.equal(loaded.config.targets.ncp.provider, "ncp-nks-buildkit");
  assert.equal(loaded.config.targets.ncp.options.prefix, "buildpouch");
});

test("process runner writes optional stdin without enabling a shell", async () => {
  const result = await runProcess({
    "executable": process.execPath,
    "args": ["-e", "process.stdin.setEncoding('utf8'); let value = ''; process.stdin.on('data', chunk => value += chunk); process.stdin.on('end', () => process.stdout.write(value.toUpperCase()));"],
    "input": "manifest input"
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "MANIFEST INPUT");
});
