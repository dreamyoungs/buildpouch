# Contributor source map

Use this map to locate evidence for a question or change. The [README](../README.md) explains the public interface, [AGENTS.md](../AGENTS.md) guides agent work, and the [contribution guide](../.github/CONTRIBUTING.md) defines the development workflow. This map does not duplicate the CLI specification or maintain a separate implementation-status inventory.

## Questions and authoritative inputs

| Question | Start here | Check behavior against |
| --- | --- | --- |
| What does the CLI do, and how is it used? | [README](../README.md), [Korean](README.ko.md), [Japanese](README.ja.md) | [CLI dispatch](../src/cli.ts), [command handlers](../src/commands/), [CLI tests](../test/cli.test.js) |
| Which configuration fields and target-selection rules are accepted? | [Configuration guide](../README.md#configuration) | [Config loader](../src/config/load.ts), [types](../src/config/types.ts), [submit orchestration](../src/submit.ts), [submit tests](../test/submit.test.js) |
| Why was a file excluded or rejected? | [Security boundaries](../README.md#security-boundaries) | [Context planner](../src/context/plan.ts), [inspection tests](../test/inspect.test.js) |
| How are staging, archives, overwrite, and cleanup handled? | [Command guide](../README.md#mvp-commands) | [Staging](../src/context/build.ts), [archive writer](../src/context/archive.ts), [pack orchestration](../src/context/pack.ts), [pack tests](../test/pack.test.js) |
| Which dependencies fail policy, and why? | [Dependency command](../src/commands/dependencies.ts) | [Policy evaluator](../src/dependencies/check.ts), [dependency tests](../test/dependencies.test.js); the caller's lockfile and policy options |
| How does Google Cloud Build submission work? | [GCP adapter](../src/providers/gcp-cloud-build.ts) | [Provider contract](../src/providers/types.ts), [process runner](../src/process/run.ts), [submit tests](../test/submit.test.js); the caller's Cloud Build config |
| How does NCP submission or uncertain cleanup work? | [NCP guide](../README.md#ncp-nks-buildkit-target) | [NCP adapter](../src/providers/ncp-nks-buildkit.ts), [NCP tests](../test/ncp-submit.test.js); the caller's Job template |
| What is returned for errors, JSON output, or cancellation? | [Command handlers](../src/commands/), [error definitions](../src/errors.ts) | [Output modules](../src/output/), [submit orchestration](../src/submit.ts), the affected command/provider test |
| Which version am I examining? | [Native manifest](../package.json), [lockfile](../package-lock.json), [changelog](CHANGELOG.md) | The selected checkout revision or installed CLI `--version`; registry/release evidence for publication questions |
| How do I develop, test, or propose a change? | [Contribution guide](../.github/CONTRIBUTING.md) | [Package scripts](../package.json), [CI](../.github/workflows/ci.yml), [pull request template](../.github/pull_request_template.md) |

## Consumer and provider boundaries

BuildPouch plans and packages explicit build inputs, evaluates dependency policy, and submits through a selected provider. The consuming repository owns its Dockerfile, Cloud Build configuration, Kubernetes Job template, and optional deployment steps. The infrastructure owner supplies the target resources, identities, and permissions.

For an integration question, identify which stage failed and read that owner's source. Do not infer a consumer's project, namespace, image, region, policy, or deployment success from BuildPouch's examples. A provider result describes the submitted build or Job; application readiness requires evidence from the consumer's deployment workflow.

`inspect` reads local configuration and metadata. `pack` creates local artifacts. `dependencies check` reads registry metadata without installing or executing packages. `submit` can create remote builds and temporary remote objects. Read the relevant command and adapter before treating an action as local-only.

## Evidence and maintenance

- Documentation describes intended public behavior; source and tests establish implemented behavior. If they disagree, state the difference and update the responsible document or implementation within the task's scope.
- Keep mock/local validation separate from live provider evidence. The README explicitly identifies NCP support as experimental pending live end-to-end validation; fixture coverage does not remove that qualification.
- Keep checkout version, installed version, and published version distinct. A changelog or manifest alone does not establish registry availability.
- Update this map when an authoritative entry point moves or a new command/provider responsibility is added. Keep exact options, defaults, and supported behavior in their existing owners.
- Validate local links and revisit the affected question route after a documentation change. Avoid adding a second source inventory, private deployment details, or tests that merely require particular prose.
