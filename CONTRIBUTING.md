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

## Changelog

Every pull request that adds a feature, fixes a bug, or makes a breaking change
**must** include a changelog entry in `CHANGELOG.md` under the `[Unreleased]`
section.

Format:

```markdown
### Added / Changed / Fixed / Removed / Security

- Short description of the user-visible change (PR #NNN)
```

If your change is purely internal (CI config, test-only, dev-tooling, typo fix)
you may skip the changelog entry.

## Release process

Releases are cut from `main` by a maintainer:

1. Update `CHANGELOG.md` — rename `[Unreleased]` to `[X.Y.Z] — YYYY-MM`, add a
   new empty `[Unreleased]` section, and update the comparison links at the bottom.
2. Commit with the message `chore: release vX.Y.Z`.
3. Create a git tag `vX.Y.Z` and push it.
4. GitHub Actions publishes the Docker images and creates a GitHub Release with
   the changelog section as the release notes body.

## Issues

Check open issues for tasks labeled `good first issue` or `help wanted`.
