# Contributing to Prism

Thank you for helping build better Stellar tooling!

## How to Contribute

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit your changes: `git commit -m "feat: your feature"`
4. Push and open a Pull Request

## Areas to Contribute

- New explorer views (contract state, event logs, storage)
- Indexer improvements in `indexer/src/`
- UI components and design
- RPC integration and data parsing
- Tests and documentation

## Project Structure

| Directory     | Description                          |
| ------------- | ------------------------------------ |
| `frontend/`   | Next.js explorer UI                  |
| `indexer/`    | Event indexer (TypeScript + Prisma)  |
| `contracts/`  | Soroban smart contracts (Rust)       |

## Commands

### Frontend (`frontend/`)

```bash
cd frontend
npm install
npm run dev        # Start dev server
npm run lint       # Run linter
npm run test       # Run tests
npm run build      # Production build
```

### Indexer (`indexer/`)

```bash
cd indexer
npm install
npm run dev             # Start indexer in watch mode
npm run test            # Run tests
npm run prisma:generate # Generate Prisma client
npm run prisma:migrate  # Run database migrations
npm run build           # Compile TypeScript
npm run start           # Run compiled output
```

### Contracts (`contracts/`)

```bash
cd contracts
cargo build         # Build contracts
cargo test          # Run contract tests
```

## Code Style

Run the linter before submitting:

```bash
cd frontend && npm run lint
```

## Issues

Check open issues for tasks labeled `good first issue` or `help wanted`.

## Further reading

- [docs/onboarding.md](docs/onboarding.md) — a first-PR walkthrough for the
  frontend, indexer, and contracts.
- [ENVIRONMENT.md](ENVIRONMENT.md) — every environment variable, with defaults.
- [GLOSSARY.md](GLOSSARY.md) — Soroban and Stellar terms in plain language.
- [docs/api-reference.md](docs/api-reference.md) — the JSON API and its
  rate-limiting/back-off model.
- [docs/troubleshooting.md](docs/troubleshooting.md) — common self-hosting
  issues and fixes.
- [adr/](adr/README.md) — architecture decision records.
- [indexer/README.md](indexer/README.md#event-processing-flow) — the indexer's
  poll → decode → persist → notify flow (sequence diagram) and database schema
  (ER diagram).

## Load testing

A k6 load test for the `GET /api/contract/[id]/events` endpoint lives in `tests/load/events-load-test.js`.
It sends 100 concurrent requests and asserts p99 latency is below 500 ms with no 5xx responses.

### Install k6

```bash
curl -fsSL https://get.k6.sh | bash
```

### Run the load test

Start the frontend, then run the load test against it:

```bash
cd frontend
npm install
npm run build
npm run start        # serves on http://localhost:3000
```

In another terminal:

```bash
CONTRACT_ID=<contract-id> k6 run tests/load/events-load-test.js
```

Override the target origin with `BASE_URL` (default `http://localhost:3000`):

```bash
BASE_URL=https://explorer.example.com CONTRACT_ID=<contract-id> k6 run tests/load/events-load-test.js
```

Results are streamed to stdout and, in CI, uploaded as workflow artifacts.

> **Note on rate limiting.** Every `/api/*` route is rate-limited (30 req/min
> per client, see the README). A single load generator therefore reaches the
> limit quickly and most requests return `429` — which is still a non-5xx,
> fast response, so the `p99 < 500 ms` and `no 5xx` thresholds hold. To load
> the backend itself, run the frontend with `TRUST_PROXY=1` behind a proxy that
> sets a distinct `X-Forwarded-For` per virtual user, or raise the limit in
> `frontend/src/lib/rate-limit.ts` for the duration of the test.
