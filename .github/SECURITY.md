# Security Policy

[Project README](https://github.com/dreamyoungs/buildpouch#readme) | [English](https://github.com/dreamyoungs/buildpouch/blob/main/.github/SECURITY.md) | [한국어](https://github.com/dreamyoungs/buildpouch/blob/main/docs/SECURITY.ko.md) | [日本語](https://github.com/dreamyoungs/buildpouch/blob/main/docs/SECURITY.ja.md)

## Supported versions

Security fixes target the latest 0.1.x release. The `main` branch may contain fixes that have not been released yet. Unofficial archives, forks, and modified builds are not supported by this policy.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Email [dev-team@dreamyoungs.com](mailto:dev-team@dreamyoungs.com) with the subject `[BuildPouch security]` and include:

- the affected command and version or commit;
- a clear description of the impact;
- minimal, sanitized reproduction steps;
- any suggested mitigation or patch.

Do not attach credentials, private repositories, production data, or an archive containing private source code. The maintainers will arrange a safer transfer method if an artifact is necessary.

We will acknowledge reports as soon as practical, investigate privately, and coordinate disclosure after a fix is available. Please allow reasonable time for validation and remediation before public disclosure.

## Security scope

Reports about path traversal, unexpected file inclusion, source mutation, secret-path bypasses, archive overwrite, temporary artifact leakage, command injection, or credential exposure are especially relevant. Configuration mistakes that BuildPouch already rejects with a documented error are normally support issues rather than vulnerabilities.
