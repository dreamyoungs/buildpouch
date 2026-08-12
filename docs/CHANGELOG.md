# Changelog

[Project README](../README.md)

All notable changes to BuildPouch will be documented in this file. The project intends to follow [Semantic Versioning](https://semver.org/) after its first public release.

## Unreleased

### Added

- TypeScript CLI bootstrap for Node.js 24.
- Strict `buildpouch.yaml` schema version 1.
- `inspect` command with allowlist planning, path validation, secret-path blocking, collision detection, and JSON output.
- `pack` command with isolated staging, portable tar.gz output, overwrite protection, cancellation cleanup, and JSON output.
- `submit` command for Google Cloud Build with existing or temporary archives, safe argument-array execution, structured results, and provider failure categories.
- Named build targets with `defaultTarget` and `submit --target`, while retaining the legacy single `build` configuration.
- NCP archive-first submission through Object Storage and repository-owned BuildKit Jobs on NKS.
- English, Korean, and Japanese project documentation.
