# Contributing to BuildPouch

[Project README](https://github.com/dreamyoungs/buildpouch#readme) | [English](https://github.com/dreamyoungs/buildpouch/blob/main/.github/CONTRIBUTING.md) | [한국어](https://github.com/dreamyoungs/buildpouch/blob/main/docs/CONTRIBUTING.ko.md) | [日本語](https://github.com/dreamyoungs/buildpouch/blob/main/docs/CONTRIBUTING.ja.md)

Thank you for helping improve BuildPouch. Keep changes focused, testable, and independent of any one company or monorepo.

## Before you start

- Use GitHub Issues for bugs and proposals. Discuss substantial changes before implementation.
- Never post credentials, secrets, private source code, or sensitive build logs.
- Read the [Code of Conduct](https://github.com/dreamyoungs/buildpouch/blob/main/.github/CODE_OF_CONDUCT.md) and [Security Policy](https://github.com/dreamyoungs/buildpouch/security/policy).

## Development setup

BuildPouch requires Node.js 24 and npm 11.12.1.

```sh
git clone https://github.com/dreamyoungs/buildpouch.git
cd buildpouch
npm ci --ignore-scripts
npm run check
npm test
```

Use a focused branch created from `main`. Follow the existing TypeScript style, keep provider-specific behavior behind the provider boundary, and add no dependency without explaining why the platform or current dependencies are insufficient.

## Tests

Before opening a pull request, run:

```sh
npm run check
npm test
npm audit --audit-level=high
npm pack --dry-run
```

Provider tests must use a mock runner or fake executable. Do not submit a real cloud build from automated tests. Cover success, validation failure, provider failure, cancellation, and temporary-file cleanup when the change affects those paths.

## Commits and pull requests

- Link every change to a GitHub issue.
- Prefer a conventional commit such as `feat(pack): preserve executable mode (#123)`.
- Keep one pull request focused on one outcome and avoid unrelated formatting or refactoring.
- Update English, Korean, and Japanese documentation together when public behavior changes.
- Explain validation performed and any behavior that could not be tested locally.

Maintainers use squash merging. A pull request may be revised or declined when it expands the MVP without a concrete use case, weakens file-safety boundaries, or introduces repository-specific assumptions.
