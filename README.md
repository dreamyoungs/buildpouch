# BuildPouch

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md)

> Pack only what your build needs.

BuildPouch is a CLI project for creating safe, minimal build context archives from monorepos and submitting them to build providers.

## Project status

BuildPouch is in pre-development. The command interface and configuration shown below are proposals and may change. No working CLI or npm package has been released yet.

This repository does not have an open-source license yet. A license will be added before the first release.

## Why BuildPouch?

An application inside a monorepo often needs files outside its own directory: shared packages, root manifests, lockfiles, generated clients, build configuration, or static assets.

Using only the application directory as a build context can omit required files. Uploading the entire monorepo can include unrelated applications, documentation, caches, or sensitive files.

BuildPouch takes an allowlist-first approach: explicitly select the files a build needs, validate where they will appear in the archive, and package only that context.

## Planned workflow

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

## Planned MVP

| Command | Responsibility |
| --- | --- |
| `buildpouch inspect` | Calculate and validate the context without copying files or contacting a cloud provider. |
| `buildpouch pack` | Stage the validated files in a temporary directory and create a `tar.gz` archive. |
| `buildpouch submit` | Pack a context, or accept an existing archive, and submit it through the configured provider. |

The first planned provider is Google Cloud Build, invoked through the existing `gcloud` CLI. Provider-specific build configuration such as `build.json` or `cloudbuild.yaml` remains owned by the repository using BuildPouch.

Planned command shape:

```sh
buildpouch inspect --config buildpouch.yaml
buildpouch pack --config buildpouch.yaml
buildpouch submit --config buildpouch.yaml
```

These commands are documentation previews and are not available yet.

## Proposed configuration

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

## Design principles

- **Allowlist first:** Include only explicitly selected build inputs.
- **Workspace preservation:** Never move, modify, or delete source files while creating a context.
- **Provider separation:** Keep context planning and packaging independent from remote build execution.
- **Visible contents:** Show included paths, file sizes, total size, and collisions before submission.
- **Small MVP:** Add dependency resolvers or provider abstractions only when a concrete use case requires them.

## Security boundaries

The MVP is planned to:

- reject source paths that escape the configured root;
- reject absolute or traversal-based archive targets;
- avoid following source symlinks by default;
- detect target collisions, including collisions on case-insensitive filesystems;
- block common secret files, credential directories, private keys, local caches, and temporary files;
- build the context outside the source workspace in a user-only temporary directory;
- clean temporary artifacts after success, failure, or cancellation.

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

The project is being designed in public. Until the initial implementation is scaffolded, please use [GitHub Issues](https://github.com/dreamyoungs/buildpouch/issues) for questions and proposals.
