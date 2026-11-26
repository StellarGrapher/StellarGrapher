# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Prism — including the rate limiter, the decoder, the indexer, or any other component — please report it **privately** through [GitHub Security Advisories](https://github.com/prism-explorer/prism/security/advisories/new).

**Do not open a public issue for security vulnerabilities.**

When reporting, please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce the issue
- Any relevant code snippets or proof-of-concept
- The commit hash you tested against

## Responsible disclosure process

1. **Submit privately** — open a [GitHub Security Advisory](https://github.com/StellarGrapher/StellarGrapher/security/advisories/new) or email the maintainers via the contact on the GitHub profile. Do **not** open a public issue.
2. **Wait for acknowledgement** — we will acknowledge your report within **48 hours** of receipt.
3. **Coordinated fix** — we will work with you to understand the impact and develop a fix. We will keep you updated at least every 7 days.
4. **Disclosure** — once a fix is ready we will coordinate a public disclosure date with you, typically within **90 days** of the initial report.
5. **Credit** — we will credit you in the security advisory and release notes unless you prefer to remain anonymous.

## Response SLA

| Event | Target |
|-------|--------|
| Acknowledgement | 48 hours |
| Initial severity assessment | 7 days |
| Fix or workaround shipped | 90 days (critical: 14 days) |

## Scope

**In scope** — please report these:

- Authentication and authorization bypasses in any component
- Logic errors in the smart contracts (`contracts/`) that could lead to fund loss or state corruption
- Indexer vulnerabilities that allow unauthorized data modification or extraction
- Cross-site scripting (XSS) or injection attacks in the frontend (`frontend/`)
- Private key or secret exposure through API responses, logs, or error messages
- Server-side request forgery (SSRF) in the indexer or backend
- Path traversal or arbitrary file read/write

**Out of scope** — please do **not** report these:

- Social engineering or phishing attacks
- Denial-of-service attacks (rate-limit bypasses are in scope)
- Vulnerabilities in third-party dependencies — report these to the upstream project
- Issues that require physical access to a device
- Missing HTTP security headers on static assets with no sensitive content
- Self-XSS that cannot affect other users
- Theoretical vulnerabilities without a proof of concept

## Acknowledgements

We appreciate the security research community's efforts to keep StellarGrapher and its users safe. Researchers who disclose issues responsibly will be listed here (with permission).
