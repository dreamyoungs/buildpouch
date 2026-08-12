# BuildPouch

[English](README.md) | [한국어](docs/README.ko.md) | [日本語](docs/README.ja.md)

> Pack only what your build needs.

BuildPouch is a CLI project for creating safe, minimal build context archives from monorepos and submitting them to build providers.

## Project status

BuildPouch 0.1.0 is the first public npm release. The `inspect`, `pack`, and `submit` MVP commands are available. The public interface may change during the 0.x release line.

## Installation

BuildPouch requires Node.js 24 or later. Install it in a project and run it with `npx`:

```sh
npm install --save-dev buildpouch
npx buildpouch --help
```

For interactive use across projects, it can also be installed globally:

```sh
npm install --global buildpouch
buildpouch --help
```

## AI-assisted development

BuildPouch makes extensive and intentional use of AI-assisted development tools across design, implementation, testing, documentation, translation, and review. We expect to continue using AI actively as the project evolves.

AI assistance does not transfer responsibility away from the maintainers. Maintainers remain accountable for technical decisions, review, security, licensing, and releases, and AI-assisted work is held to the same quality and testing standards as any other contribution.

Contributions are welcome whether they are written by people, assisted by AI, or combine both. Please disclose material AI use when it introduces review, provenance, or licensing considerations that maintainers should evaluate.

## Local development

BuildPouch currently requires Node.js 24 and npm 11.12.1.

```sh
npm install
npm run check
npm test
npm pack --dry-run
```

After building, run the local CLI with `node dist/cli.js --help`.

## Why BuildPouch?

An application inside a monorepo often needs files outside its own directory: shared packages, root manifests, lockfiles, generated clients, build configuration, or static assets.

Using only the application directory as a build context can omit required files. Uploading the entire monorepo can include unrelated applications, documentation, caches, or sensitive files.

BuildPouch takes an allowlist-first approach: explicitly select the files a build needs, validate where they will appear in the archive, and package only that context.

## Workflow

```text
Configuration and CLI arguments
              │
              ▼
       Context planning
              │
              ▼
  Path, collision, and security checks
              │
              ▼
  Isolated temporary staging directory
              │
              ▼
        tar.gz archive
              │
              ▼
       Build provider adapter
```

Context creation and provider submission remain separate stages so that failures are clear and each stage can be tested independently.

## MVP commands

| Command | Status | Responsibility |
| --- | --- | --- |
| `buildpouch inspect` | Available | Calculate and validate the context without copying files or contacting a cloud provider. |
| `buildpouch pack` | Available | Stage the validated files in a temporary directory and create a `tar.gz` archive. |
| `buildpouch submit` | Available | Pack a context, or accept an existing archive, and submit it through the configured provider. |

Supported providers are Google Cloud Build through the existing `gcloud` CLI and NCP NKS BuildKit through the existing `aws` and `kubectl` CLIs. Provider-specific build configuration, Kubernetes Job templates, and deployment behavior remain owned by the repository using BuildPouch. NCP support is experimental until it completes live end-to-end validation against NCP Object Storage, NKS, and Container Registry.

Command shape:

```sh
buildpouch inspect --config buildpouch.yaml
buildpouch pack --config buildpouch.yaml
buildpouch submit --config buildpouch.yaml --target gcp-development
```

After installing BuildPouch in a project, run commands through `npx`:

```sh
npx buildpouch inspect --config buildpouch.yaml
npx buildpouch inspect --config buildpouch.yaml --json
npx buildpouch pack --config buildpouch.yaml
npx buildpouch pack --config buildpouch.yaml --output customer-api.context.tar.gz --json
npx buildpouch submit --config buildpouch.yaml
npx buildpouch submit --config buildpouch.yaml --archive customer-api.context.tar.gz --json
```

`inspect` reads metadata only. It reports every source-to-target mapping, individual file size, file count, and total size without staging files or contacting a provider.

`pack` repeats the same validation, copies the selected files into an isolated temporary directory, and writes a portable gzip-compressed tar archive. The default output is `<context.name>.context.tar.gz` in the current directory. Existing archives are preserved unless `--force` is supplied. Use `--keep-context` only when you need to inspect the staging directory after the command finishes.

`submit` selects the target passed with `--target`, then `defaultTarget`, then the legacy `build` section. A sole named target is selected automatically; multiple named targets require either `--target` or `defaultTarget`. A Google Cloud Build target requires an authenticated Google Cloud CLI. An NCP target requires authenticated AWS CLI access to NCP Object Storage and a `kubectl` context for the target NKS cluster. Without `--archive`, `submit` creates an internal temporary archive, waits for the build to finish, and then removes that local archive. A local archive supplied with `--archive` is never removed.

Provider values can be overridden for one invocation:

```sh
node dist/cli.js submit --config buildpouch.yaml --target gcp-development \
  --project another-project \
  --region us-central1 \
  --build-config ./cloudbuild.yaml \
  --substitution _APP_NAME=customer-api
```

## Configuration

```yaml
schemaVersion: 1

context:
  name: customer-api
  root: .
  entries:
    - source: apps/customer/api/dist
      target: .
      required: true
    - source: apps/customer/api/Dockerfile
      target: Dockerfile
      required: true
    - source: apps/customer/api/static
      target: static
      required: false

  exclude:
    - "**/node_modules/**"
    - "**/.git/**"
    - "**/coverage/**"

defaultTarget: gcp-development

targets:
  gcp-development:
    provider: gcp-cloud-build
    options:
      config: apps/customer/api/deploy/gcp/build.json
      project: example-project
      region: asia-northeast3
      substitutions:
        _APP_NAME: customer-api

  gcp-production:
    provider: gcp-cloud-build
    options:
      config: apps/customer/api/deploy/gcp/build.json
      project: production-project
      region: asia-northeast3
      substitutions:
        _APP_NAME: customer-api

  ncp-development:
    provider: ncp-nks-buildkit
    options:
      endpoint: https://kr.object.ncloudstorage.com
      region: kr-standard
      bucket: example-build-contexts
      prefix: buildpouch/development
      awsProfile: ncp
      kubeContext: nks-development
      namespace: build-system
      jobTemplate: apps/customer/api/deploy/ncp/build-job.yaml
      container: buildpouch
      timeoutSeconds: 1800
      pollIntervalSeconds: 5
      variables:
        IMAGE_REF: example.kr.ncr.ntruss.com/customer-api:development
        DEPLOYMENT_NAME: customer-api
```

Entries form the source allowlist. Each entry maps a file, directory, or supported glob from `context.root` to a path inside the archive. Exclusions narrow the allowlist but never define the context by themselves.

Relative `context.root` values are resolved from the configuration file directory. Entry sources are then resolved from that root. `required` defaults to `true`; a required entry that is missing or becomes empty after exclusions fails inspection.

Named targets keep environment and provider choices outside the shared context definition. Target names may contain letters, numbers, dots, underscores, and hyphens. Provider-specific values live under `targets.<name>.options`. For backward compatibility, the original single `build` section remains supported and takes precedence when neither `--target` nor `defaultTarget` selects a named target.

The examples use `buildpouch.yaml`, but the YAML parser also accepts JSON syntax when a JSON-formatted BuildPouch configuration is preferred. Existing application `config.json` files are not interpreted automatically because their schemas belong to the application; repository-owned tasks may read them and generate or select BuildPouch target values. Existing GCP `build.json` files remain directly usable through a GCP target's `config` field.

Relative Google Cloud Build `config` paths are resolved from the configuration file directory. A `--build-config` override is resolved from the current working directory. User-defined Cloud Build substitution keys must begin with `_` and contain only uppercase letters, numbers, and underscores. Substitution values appear in command output; use Secret Manager through the build configuration instead of passing secrets as substitutions.

### NCP NKS BuildKit target

The `ncp-nks-buildkit` provider keeps BuildPouch's archive-first contract while using NCP services:

1. upload a uniquely named context archive to the configured private [NCP Object Storage](https://api.ncloud-docs.com/docs/en/storage-objectstorage) bucket through its S3-compatible API;
2. inject reserved `BUILDPOUCH_*` metadata and configured nonsecret `variables` into one named container in a repository-owned `batch/v1` Job template;
3. create the Job in the existing NKS context and namespace, then poll it to a terminal state;
4. remove the temporary Object Storage object after a confirmed success or remote failure.

BuildPouch does not provision the bucket, NKS cluster, [Container Registry](https://guide.ncloud-docs.com/docs/en/containerregistry-overview), Kubernetes service account, RBAC, credentials, or registry pull/push secrets. The Job template owns the actual archive download, SHA-256 verification, extraction, BuildKit invocation, image push, and any optional NKS deployment. This lets one template build and push only, while another can also deploy, without placing deployment semantics in BuildPouch. BuildPouch leaves terminal Jobs for inspection; set `ttlSecondsAfterFinished` in the template when automatic Job cleanup is desired.

The selected container receives these reserved variables: `BUILDPOUCH_CONTEXT_ENDPOINT`, `BUILDPOUCH_CONTEXT_REGION`, `BUILDPOUCH_CONTEXT_BUCKET`, `BUILDPOUCH_CONTEXT_KEY`, `BUILDPOUCH_CONTEXT_NAME`, `BUILDPOUCH_CONTEXT_SIZE`, `BUILDPOUCH_CONTEXT_SHA256`, `BUILDPOUCH_SUBMISSION_ID`, and `BUILDPOUCH_TARGET`. Existing environment entries with those names are replaced. Template-owned `secretKeyRef`, volumes, commands, images, security context, and other containers are preserved.

`endpoint`, `region`, `bucket`, `kubeContext`, `namespace`, and `jobTemplate` are required. `prefix` defaults to `buildpouch`, `container` to `buildpouch`, `timeoutSeconds` to 1800, and `pollIntervalSeconds` to 5. Relative `jobTemplate` paths are resolved from the BuildPouch configuration directory. `awsProfile` selects a local AWS CLI profile and is not sent to the Job. `variables` are visible in the Job manifest and must never contain credentials or secrets; use Kubernetes Secrets in the template instead.

If Job creation is definitively rejected, BuildPouch removes the uploaded object. An ambiguous creation result, or cancellation, timeout, or ambiguous polling after acceptance, preserves the Job and source object so a possibly running build is not broken. Inspect the reported Job and remove the exact object after confirming that it is no longer needed. A successful result uses a `kubernetes://<context>/<namespace>/jobs/<name>` locator rather than claiming a provider web-console URL.

## Design principles

- **Allowlist first:** Include only explicitly selected build inputs.
- **Workspace preservation:** Never move, modify, or delete source files while creating a context.
- **Provider separation:** Keep context planning and packaging independent from remote build execution.
- **Visible contents:** Show included paths, file sizes, total size, and collisions before submission.
- **Small MVP:** Add dependency resolvers or provider abstractions only when a concrete use case requires them.

## Security boundaries

The current commands:

- reject source paths that escape the configured root;
- reject absolute or traversal-based archive targets;
- avoid following source symlinks by default;
- detect target collisions, including collisions on case-insensitive filesystems;
- block common secret files, credential directories, private keys, local caches, and temporary files;
- make the staging directory accessible only to the current user and create it outside the source workspace;
- write the archive to a unique sibling temporary file before finalizing it;
- refuse to overwrite an existing archive unless `--force` is explicit;
- clean staging and partial archive artifacts after success, failure, or cancellation unless `--keep-context` is explicit;
- invoke `gcloud`, `aws`, and `kubectl` with argument arrays and without a shell;
- use the current CLI identities without reading or storing cloud credentials;
- pass NCP Job manifests through `kubectl` standard input rather than a shell or a persistent generated file;
- expose NCP variable names, but not configured variable values, in prepared human and JSON output;
- remove only archives created internally by `submit`, while preserving user-supplied archives.

Cancelling `submit` stops the active local provider process and cleans local temporary files. It does not promise to cancel a remote build already accepted by Cloud Build or NKS. The NCP preservation behavior after Job acceptance is described above.

Path-based blocking is not a content-aware secret scanner. CI should use a dedicated security tool when file-content scanning is required.

## Non-goals for the MVP

BuildPouch will not:

- compile TypeScript, Rust, Go, or other application code;
- resolve Nx, pnpm, Cargo, or Go dependency graphs automatically;
- generate or modify lockfiles, Dockerfiles, or build configuration;
- deploy directly to Kubernetes, Cloud Run, or other runtime platforms;
- create, store, or synchronize cloud credentials and secrets;
- manage Git commits, releases, or external notifications.

Repository-owned tasks may prepare compiled output or a pruned dependency tree before invoking BuildPouch.

## Contributing

The project is being designed in public. Please read the [contribution guide](.github/CONTRIBUTING.md) and [Code of Conduct](.github/CODE_OF_CONDUCT.md), and use [GitHub Issues](https://github.com/dreamyoungs/buildpouch/issues) for questions and proposals before opening a substantial pull request. Report vulnerabilities through the [Security Policy](.github/SECURITY.md), never through a public issue.

Notable changes are tracked in the [Changelog](docs/CHANGELOG.md).

## License

BuildPouch is licensed under the [Apache License 2.0](LICENSE).
