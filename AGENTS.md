# Repository instructions

## Locate the relevant source

- For questions, investigation, and changes, start with the [contributor source map](docs/index.md) and read the relevant documentation, source, and tests. Do not load every document for every task.
- Follow the repository and version named by the user. Confirm the actual Git root, branch, and revision; the current working directory does not determine which project the question concerns.
- BuildPouch owns a general-purpose CLI. A consuming repository owns its build inputs, deployment configuration, and application behavior. Its infrastructure owner manages cloud resources and IAM. For integration questions, read each relevant repository's instructions and authoritative inputs.
- Do not import a consuming application's architecture, credentials, environments, approval history, branch strategy, or private documentation into this public project. Check the scope of any skill before applying it.
- Distinguish documented intent, implemented behavior, local test evidence, and live provider validation. A successful mock test is not proof of a deployed integration; a package version in source is not proof of publication.

## Make focused changes

- Read the affected source and failure-path tests before editing. Define the intended result and files first; preserve existing patterns and keep changes within the user's scope.
- Keep context planning, staging/archive creation, dependency inspection, and provider submission in their existing boundaries. Repository-owned build configuration and Job templates own build and deployment semantics.
- Preserve source-workspace safety, credential boundaries, explicit overwrite behavior, and cancellation/cleanup semantics. See the [README](README.md) and [security policy](.github/SECURITY.md).
- Update source comments and the relevant documentation when behavior or ownership changes. Document only guarantees the code actually provides. Do not edit generated `dist/` files.
- Keep user-facing English, Korean, and Japanese documentation aligned when public behavior changes, as required by the contribution guide.

## Validate and contribute

- Follow [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) for setup, checks, issue linkage, and pull requests. This project uses branches from `main` and squash merges; do not assume another repository's `dev` or direct-merge workflow.
- Keep the primary checkout on `main` and use a separate `.worktree/` checkout for task branches. Do not switch another task's branch or discard its changes.
- Run checks appropriate to the change and the contribution guide. Provider tests use mock runners or fake executables; automated tests must not submit real cloud builds.
- When source or documentation disagree, report the difference and fix the relevant owner within scope. Review dates and ADR-like prose do not override actual CLI behavior or establish that a live provider test occurred.
