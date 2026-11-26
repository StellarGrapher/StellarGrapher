# First Pull Request — Onboarding Walkthrough

This guide walks you through your first contribution to Prism, end to end, for
each of the three parts of the repo: `frontend/`, `indexer/`, and `contracts/`.
The commands below are real; terminal output is shown as an example and may
differ slightly by machine.

## 0. Prerequisites

- [Node.js](https://nodejs.org) 20 (see `.nvmrc`) and npm.
- [Rust](https://rustup.rs) with the `wasm32v1-none` target (only for
  `contracts/`). The pinned toolchain in `contracts/rust-toolchain.toml` is
  installed automatically by `rustup`.
- [Docker](https://docs.docker.com) (optional, for the full Compose stack).
- A [GitHub](https://github.com) account.

## 1. Fork and clone

Fork `StellarGrapher/StellarGrapher` on GitHub, then clone **your** fork and
add the upstream remote:

```bash
git clone https://github.com/<your-user>/StellarGrapher.git
cd StellarGrapher
git remote add upstream https://github.com/StellarGrapher/StellarGrapher.git
```

## 2. Create a branch

Always branch off the latest `main`:

```bash
git fetch upstream
git checkout -b feat/my-change upstream/main
```

Example output:

```text
Switched to a new branch 'feat/my-change'
```

## 3. Run the app locally

Pick the part you are changing.

### Frontend (`frontend/`)

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Example output:

```text
▲ Next.js 14.x
- Local:        http://localhost:3000
✓ Ready in 1.2s
```

Open <http://localhost:3000>. The frontend works standalone against public
testnet endpoints — no database required.

### Indexer (`indexer/`)

The indexer needs Postgres. The easiest path is the Compose stack from the repo
root, which starts Postgres, the indexer, and the frontend together:

```bash
docker compose up
```

To run the indexer directly against a local Postgres instead:

```bash
cd indexer
npm install
export DATABASE_URL="postgresql://prism:prism@localhost:5432/prism"
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Example output:

```text
indexer listening on :8080, polling https://soroban-testnet.stellar.org every 5000ms
```

### Contracts (`contracts/`)

```bash
cd contracts
cargo test
```

Example output:

```text
running 23 tests
test result: ok. 23 passed; 0 failed; 0 ignored
```

## 4. Make a change

Edit the relevant files. Keep changes focused; unrelated reformatting makes
review harder. Follow the existing style of the file you are editing.

## 5. Run the checks

Run the same checks CI runs for the part you touched.

**Frontend:**

```bash
cd frontend
npx tsc --noEmit
npm run lint
npm test
npm run build
```

**Indexer:**

```bash
cd indexer
npx prisma generate
npx tsc --noEmit
npm run lint
npm test
npm run build
```

**Contracts:**

```bash
cd contracts
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo build --release --target wasm32v1-none
```

All of the above must pass before you push.

## 6. Commit and push

```bash
git add <files>
git commit -m "feat: describe your change"
git push origin feat/my-change
```

## 7. Open the Pull Request

Open a PR from your branch against `StellarGrapher/StellarGrapher:main`. Fill in
the PR template: what changed, how you tested it, and any linked issues (for
example `Closes #123`).

A maintainer will review. If changes are requested, make them on the same
branch and push again — the PR updates automatically. Once CI is green and the
review is approved, a maintainer merges.

## Where to go next

- [ENVIRONMENT.md](../ENVIRONMENT.md) — every environment variable explained.
- [GLOSSARY.md](../GLOSSARY.md) — Soroban terms used throughout the codebase.
- [docs/troubleshooting.md](./troubleshooting.md) — common self-hosting issues.
- [docs/api-reference.md](./api-reference.md) — the JSON API and rate limits.
- [adr/](../adr/README.md) — architecture decisions behind the design.