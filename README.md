# BuildPouch

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md)

> Pack only what your build needs.

BuildPouch is a CLI project for creating safe, minimal build context archives from monorepos and submitting them to build providers.

## Project status

BuildPouch is in early development. The `inspect`, `pack`, and `submit` MVP commands are available from source. The public interface may change, and no npm package has been released yet.

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
| `buildpouch inspect` | Available from source | Calculate and validate the context without copying files or contacting a cloud provider. |
| `buildpouch pack` | Available from source | Stage the validated files in a temporary directory and create a `tar.gz` archive. |
| `buildpouch submit` | Available from source | Pack a context, or accept an existing archive, and submit it through the configured provider. |

The first provider is Google Cloud Build, invoked through the existing `gcloud` CLI. Provider-specific build configuration such as `build.json` or `cloudbuild.yaml` remains owned by the repository using BuildPouch.

Command shape:

```sh
buildpouch inspect --config buildpouch.yaml
buildpouch pack --config buildpouch.yaml
buildpouch submit --config buildpouch.yaml
```

Until the npm package is released, build the project and run the commands locally:

```sh
npm run build
node dist/cli.js inspect --config buildpouch.yaml
node dist/cli.js inspect --config buildpouch.yaml --json
node dist/cli.js pack --config buildpouch.yaml
node dist/cli.js pack --config buildpouch.yaml --output customer-api.context.tar.gz --json
node dist/cli.js submit --config buildpouch.yaml
node dist/cli.js submit --config buildpouch.yaml --archive customer-api.context.tar.gz --json
```

`inspect` reads metadata only. It reports every source-to-target mapping, individual file size, file count, and total size without staging files or contacting a provider.

`pack` repeats the same validation, copies the selected files into an isolated temporary directory, and writes a portable gzip-compressed tar archive. The default output is `<context.name>.context.tar.gz` in the current directory. Existing archives are preserved unless `--force` is supplied. Use `--keep-context` only when you need to inspect the staging directory after the command finishes.

`submit` requires the Google Cloud CLI to be installed and authenticated. Without `--archive`, it creates an internal temporary archive, waits for Cloud Build to finish, and then removes that archive. An archive supplied with `--archive` is never removed. The final build ID, status, duration, and Cloud Console URL are available in both human and JSON output.

Provider values can be overridden for one invocation:

```sh
node dist/cli.js submit --config buildpouch.yaml \
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

build:
  provider: gcp-cloud-build
  config: apps/customer/api/deploy/gcp/build.json
  project: example-project
  region: asia-northeast3
  substitutions:
    _APP_NAME: customer-api
```

Entries form the source allowlist. Each entry maps a file, directory, or supported glob from `context.root` to a path inside the archive. Exclusions narrow the allowlist but never define the context by themselves.

Relative `context.root` values are resolved from the configuration file directory. Entry sources are then resolved from that root. `required` defaults to `true`; a required entry that is missing or becomes empty after exclusions fails inspection.

Relative `build.config` paths are also resolved from the configuration file directory. A `--build-config` override is resolved from the current working directory. User-defined Cloud Build substitution keys must begin with `_` and contain only uppercase letters, numbers, and underscores. Substitution values appear in command output; use Secret Manager through the build configuration instead of passing secrets as substitutions.

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
- clean staging and partial archive artifacts after success, failure, or cancellation unless `--keep-context` is explicit.
- invoke `gcloud` with an argument array and without a shell;
- use the current `gcloud` identity without reading or storing cloud credentials;
- remove only archives created internally by `submit`, while preserving user-supplied archives.

Cancelling `submit` stops the local `gcloud` process and cleans temporary files. It does not promise to cancel a remote build that Cloud Build has already accepted.

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

The project is being designed in public. Please read the [contribution guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md), and use [GitHub Issues](https://github.com/dreamyoungs/buildpouch/issues) for questions and proposals before opening a substantial pull request. Report vulnerabilities through the [Security Policy](SECURITY.md), never through a public issue.

Notable changes are tracked in the [Changelog](CHANGELOG.md).

## License

BuildPouch is licensed under the [Apache License 2.0](LICENSE).
