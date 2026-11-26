# Troubleshooting

A guide to the problems self-hosters hit most often, and how to diagnose them.
Each section lists the symptom, the usual cause, and the fix.

## Postgres connection refused

**Symptom.** The indexer (or the frontend's indexer-backed views) logs
`ECONNREFUSED`, `password authentication failed`, or `database does not exist`,
and `/api/contract/[id]/storage/full` returns nothing.

**Causes and fixes.**

- **The database is not reachable.** For the Compose stack, confirm the
  `postgres` service is healthy: `docker compose ps` should show it as
  `healthy`. The healthcheck runs `pg_isready -U prism`.
- **Wrong `DATABASE_URL`.** The value must match the Compose service name and
  credentials, e.g.
  `postgresql://prism:prism@postgres:5432/prism` inside Compose, or
  `postgresql://prism:prism@localhost:5432/prism` from the host. If you set
  `POSTGRES_PASSWORD`, the same password must appear in `DATABASE_URL`.
- **TLS mismatch.** For a managed Postgres that requires TLS, set
  `DATABASE_SSL=true` (verify the certificate) or `DATABASE_SSL=no-verify`
  (encrypt without verifying, for providers whose CA Node does not trust).
  `DATABASE_SSL=false` disables TLS and is correct only for local Compose.
- **Port not published.** Compose publishes Postgres only on
  `127.0.0.1:5432`. Connecting from another machine will be refused by design;
  use the Compose network or a tunnel.

See [ENVIRONMENT.md](../ENVIRONMENT.md) for the full variable reference.

## RPC endpoint returning 429

**Symptom.** Indexer logs show HTTP `429 Too Many Requests` from the Soroban
RPC endpoint, and the health endpoint reports the cursor falling behind
(`lag` climbing).

**Cause.** The shared public RPC nodes rate-limit by IP. A busy indexer, or
several indexers behind one egress IP, can exceed the node's budget.

**Fixes.**

- Point `SOROBAN_RPC_URL` at your own Soroban RPC node, or a provider plan with
  a higher limit.
- Increase `POLL_INTERVAL_MS` so the indexer polls less often (the default is
  `5000` ms). The indexer already retries with exponential backoff and jitter
  (1 s doubling to a 60 s cap) and resets once a poll succeeds, so transient
  429s do not lose data — the cursor only advances after a successful page.
- Run fewer indexer replicas against the same RPC endpoint.

## Front-end showing "indexer not available"

**Symptom.** The contract page renders, but storage-key enumeration, full
invocation history, and older events are missing, and a banner or empty state
says the indexer is unavailable.

**Cause.** The frontend only uses indexed data when `DATABASE_URL` is set
(`isIndexerConfigured()` in `frontend/src/lib/indexed-db.ts`). Without it the
frontend runs standalone against public RPC/Horizon, which is bounded by the
node's ~24 h retention window and cannot enumerate storage keys at all.

**Fixes.**

- Set `DATABASE_URL` (and the `DATABASE_*` tuning vars) on the frontend so it
  can read the indexer's tables.
- Confirm the indexer is actually running and healthy:
  `curl http://localhost:8080/healthz` should return `{"healthy":true,...}`.
  A `503` means the cursor is trailing the network by more than
  `HEALTH_MAX_LEDGER_LAG` ledgers.
- Remember the indexer is **forward-only**: it only has data observed since it
  started (plus any ranges loaded with the backfill command). A contract that
  was active before the indexer launched will show a gap, not a failure.

## Docker Compose port conflicts

**Symptom.** `docker compose up` fails with `Bind for 0.0.0.0:5432 failed:
port is already allocated` (or the same for `3000`).

**Cause.** Another process — often a local Postgres or a previous frontend —
already holds the host port.

**Fixes.**

- Stop the conflicting process, or change the host-side port mapping in
  `docker-compose.yml` (for example `"5433:5432"`), then update
  `DATABASE_URL` to match.
- The frontend publishes `3000:3000`; change the left-hand side to pick a
  different host port.
- `docker compose down` (without `-v`) stops the stack without deleting the
  Postgres volume; add `-v` only if you intend to wipe indexed data.

## General diagnostics

- **Indexer health:** `curl http://localhost:8080/healthz` — `200` is healthy,
  `503` means the cursor is lagging beyond `HEALTH_MAX_LEDGER_LAG`.
- **Frontend health:** `curl http://localhost:3000/` should return `200`.
- **Logs:** `docker compose logs -f indexer` and
  `docker compose logs -f frontend`.
- **Rate limits:** if the frontend itself is returning `429`, see the
  [API reference rate-limiting section](./api-reference.md#rate-limiting).