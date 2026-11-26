# Changelog

All notable changes to StellarGrapher are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Unreleased changes live on `main` until a tagged release is cut.

---

## [Unreleased]

### Added
- Contract pages and APIs gain TTL details, CSV exports, bookmarks, sortable history APIs, invocation argument decoding, keyboard shortcuts, and safer XDR navigation (PRs #172, #171, #158, #157, #156, #155, #154)
- Indexer improvements add contract filtering, batching/checkpointed backfills, token and storage-change indexing, retention, failover, and query/pool diagnostics (PRs #168, #167, #165, #164, #162, #160)
- Local-network setup, HSTS, and contract-contribution documentation are expanded (PRs #177, #176, #175)
- Env-var validation, metrics exposure, and pluggable rate limiter in the indexer (PR #185)
- Postgres pool size configurable from environment (PR #183)
- Indexer decoder fixtures from real Testnet data (PR #182)
- Item counts in contract page section headers (PR #181, #179)
- RPC event lookup failures reported separately from empty results (PR #184)

### Fixed
- Contract page section-item count display (PR #179)
- XDR decoder: split partial-decode from spec fuzz, improved error paths (PR #172)
- API hardening: Horizon error propagation, pagination fixes (PR #174)
- Indexer reliability: exponential backoff, v3 events, `/healthz`, graceful shutdown (PR #175)

---

## [0.3.0] — 2026-10

### Added
- Auth relay service and execStellarCli integration (PR #185)
- Soroban v3 event support in the indexer (PR #175)

### Fixed
- Issues #17, #22, #25 — stale docs and minor contract page regressions (PR #176)
- Issues #27, #30, #33 — indexer reliability and XDR edge cases (PR #170)
- Issues #31, #34, #35, #44 — Horizon error handling and API hardening (PR #171)

---

## [0.2.0] — 2026-09

### Added
- Contract explorer with event log and storage views
- Indexer: Prisma-backed persistence, rate limiter, decoder

### Fixed
- Issues #9, #14, #15, #79 — section item counts, layout regressions (PR #179)

---

## [0.1.0] — 2026-08

### Added
- Initial monorepo: `frontend/` (Next.js), `indexer/` (TypeScript + Prisma), `contracts/` (Rust/Soroban)
- Docker Compose development environment
- CI pipeline (lint, typecheck, test, build)
- Basic Stellar Testnet event indexing

[Unreleased]: https://github.com/StellarGrapher/StellarGrapher/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/StellarGrapher/StellarGrapher/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/StellarGrapher/StellarGrapher/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/StellarGrapher/StellarGrapher/releases/tag/v0.1.0
