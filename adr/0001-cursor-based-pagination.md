# 0001. Cursor-based pagination over offset pagination

- Status: accepted
- Date: 2026-11-26
- Deciders: Prism maintainers

## Context

The explorer pages a contract's invocation history and emitted events, which
the indexer stores in append-only Postgres tables (`Invocation`,
`ContractEventRecord`). Two properties of this data make offset pagination
(`LIMIT n OFFSET m`) a poor fit:

- **Rows are immutable and new rows arrive constantly.** The indexer inserts
  new invocations/events at the head of the list (newest first) every few
  seconds. With offset pagination, a page boundary computed as `OFFSET m` shifts
  whenever a row is inserted above it, so the next page silently repeats or
  skips rows.
- **The tables are large and grow without bound.** `OFFSET m` forces Postgres
  to scan and discard `m` rows on every request, so deep pages get linearly
  slower.

We need stable paging that neither duplicates nor drops rows as the live
dataset moves, and that stays fast at any depth.

## Decision

Paginate history with a **keyset (cursor) cursor**, not an offset. A cursor
names the last row a page returned by its `(ledger, id)` pair — the same
ordering the query uses (`ORDER BY ledger DESC, id DESC`). The next page starts
strictly after that pair:

```sql
WHERE "contractId" = $1
  AND ($2::int IS NULL OR (ledger, id) < ($2::int, $3::text))
ORDER BY ledger DESC, id DESC
LIMIT $4
```

The cursor is encoded as base64url JSON (`encodeCursor` in
`frontend/src/lib/history-cursor.ts`) and round-tripped through a `?cursor=`
query parameter. A page fetches `limit + 1` rows; the extra row only signals
that another page exists (`takePage`).

The RPC fallback path (no indexer configured) has only the node's ~24 h
retention window and no stable ordering to page on, so it returns that window
once and never offers a next cursor.

## Consequences

- **Stable paging.** Inserts above the cursor never shift a boundary, so rows
  are neither repeated nor skipped while the indexer runs.
- **Depth-independent performance.** The index on `(contractId, ledger)` and the
  `(ledger, id)` comparison let Postgres seek to the cursor instead of
  discarding rows.
- **Opaque cursors.** Clients treat the cursor as an opaque token; its format is
  an implementation detail and may change. Malformed cursors are rejected with
  `400`.
- **No random access.** A client cannot jump to "page 50" directly; it must walk
  pages. This is acceptable for an append-only, newest-first history.
- **Total ordering required.** The `(ledger, id)` pair must be unique; `id` is a
  `cuid` primary key, so it is.