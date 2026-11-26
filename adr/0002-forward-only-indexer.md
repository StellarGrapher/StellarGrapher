# 0002. The indexer is forward-only

- Status: accepted
- Date: 2026-11-26
- Deciders: Prism maintainers

## Context

Prism's optional `indexer/` service exists to remove two limits of plain RPC
access: the node's ~24 h retention window for events/history, and the inability
to enumerate a contract's storage keys at all. It does this by polling Soroban
RPC and persisting deployments, invocations, storage changes, and events into
Postgres.

A natural question is whether the indexer should backfill history from the
network's genesis (or from some far-past ledger) automatically on first run, so
a fresh deployment immediately has full history.

We decided against automatic historical backfill for the live indexer, for
several reasons:

- **RPC nodes do not serve arbitrary history.** Public and most self-hosted
  nodes retain only a recent window (often ~24 h, sometimes a few weeks). A
  full backfill from genesis is simply not possible against them; it would fail
  partway and leave a partial, misleading dataset.
- **Backfill is expensive and slow.** Replaying every historical ledger is a
  large, long-running job that competes with live indexing for the same RPC
  budget and database. Coupling it to process startup would make the indexer
  slow to become healthy and hard to reason about.
- **Most users want "from now on".** The common case is an operator who wants
  complete data going forward, not a historical archive of the whole network.

## Decision

The live indexer is **forward-only**. On first run it seeds its cursor at the
current latest ledger (or just before `INDEXER_START_LEDGER` if set, which must
fall inside the RPC node's retention window). It then advances forward only. It
performs **no automatic historical backfill.**

Historical ranges are loaded **explicitly and separately** with the `backfill`
command (`npm run backfill -- --from 1000 --to 2000`), which:

- uses the same transaction processor as live indexing,
- checkpoints progress in `BackfillCursor` after each RPC page so an interrupted
  run resumes safely,
- is idempotent (`skipDuplicates` on insert), and
- requires the requested end ledger to be available from the configured RPC
  node.

Live and backfill cursors are tracked independently (`IndexerCursor` vs
`BackfillCursor`) so a backfill can coexist with live indexing. Ledger ranges
the live indexer could not index because the retention window had already passed
are recorded in `IndexerGap` and surfaced to the frontend as `historyGaps`.

## Consequences

- **Fast, predictable startup.** A fresh indexer is healthy as soon as it has
  caught up to the network tip, with no long backfill blocking it.
- **No false completeness.** The indexer never claims to hold data it cannot
  have; gaps are explicit (`IndexerGap`) rather than silent holes.
- **History is opt-in.** Operators who need the past run the backfill command
  deliberately, scoped to a range the node can serve.
- **Data before the start point is absent.** Anything before the live start
  ledger and outside a completed backfill range remains unindexed — by design.
- **Operational clarity.** "Forward-only live + explicit backfill" is a simpler
  mental model than "the indexer might be busy backfilling", and it keeps the
  live path and the historical path independently runnable and testable.