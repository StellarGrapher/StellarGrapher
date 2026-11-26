# Environment Variables

Every environment variable Prism reads, consolidated in one place. Values come
from the `.env.example` files in the repo root, `frontend/`, and `indexer/`,
plus `docker-compose.yml`. Copy the relevant example to `.env` (or `.env.local`
for the frontend) and adjust.

Legend: **Required** means the service will not start / work correctly without
it. **Default** is the value used when the variable is unset.

## Frontend (`frontend/`)

The frontend runs standalone against public endpoints with only
`NEXT_PUBLIC_NETWORK` set; the endpoint URLs default per network.

| Name                        | Required | Default                                   | Description |
| --------------------------- | -------- | ----------------------------------------- | ----------- |
| `NEXT_PUBLIC_NETWORK`       | no       | `testnet`                                 | Stellar network: `testnet`, `mainnet`, or `futurenet`. Selects the default Horizon/RPC endpoints. |
| `NEXT_PUBLIC_HORIZON_URL`   | no       | per-network public Horizon URL            | Horizon REST endpoint. Override to use your own node. |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | no     | per-network public Soroban RPC URL        | Soroban RPC endpoint for contract data. Override to use your own node. |
| `NEXT_PUBLIC_SITE_URL`      | no       | `http://localhost:3000`                   | Public site URL, used to build absolute OG/social image URLs. |
| `DATABASE_URL`              | no       | *(unset)*                                 | Postgres connection string. When set, the frontend serves indexer-backed data (full storage enumeration, unbounded history). When unset, it runs standalone against RPC. |
| `DATABASE_POOL_MAX`         | no       | `10`                                      | Maximum Postgres pool connections. |
| `DATABASE_IDLE_TIMEOUT_MS`  | no       | `10000`                                   | Close idle pool connections after this many milliseconds. |
| `DATABASE_SSL`              | no       | `false`                                   | TLS for `DATABASE_URL`: `true` verifies the server certificate, `no-verify` encrypts without verifying, `false` disables TLS. |
| `RATE_LIMIT_REDIS_URL`      | no       | *(unset)*                                 | Redis URL for a distributed rate limiter. When set, all instances share one combined limit instead of each enforcing it independently. |
| `TRUST_PROXY`               | no       | *(unset)*                                 | Set to `1` only behind a trusted reverse proxy to trust the first `X-Forwarded-For` value for per-IP rate limiting. Leave unset otherwise. |

Example `frontend/.env.local`:

```bash
NEXT_PUBLIC_NETWORK=testnet
DATABASE_URL=postgresql://prism:prism@localhost:5432/prism
```

## Indexer (`indexer/`)

| Name                    | Required | Default                              | Description |
| ----------------------- | -------- | ------------------------------------ | ----------- |
| `DATABASE_URL`          | **yes**  | *(none)*                             | Postgres connection string. No silent fallback. |
| `SOROBAN_RPC_URL`       | no       | `https://soroban-testnet.stellar.org`| Soroban RPC endpoint to poll. |
| `POLL_INTERVAL_MS`      | no       | `5000`                               | Milliseconds between poll cycles. Must be a positive integer. |
| `HEALTH_PORT`           | no       | `8080`                               | Port for the `GET /healthz` and `GET /metrics` endpoints. |
| `HEALTH_MAX_LEDGER_LAG` | no       | `60`                                 | `/healthz` returns `503` when the cursor trails the network by more than this many ledgers. |
| `INDEXER_START_LEDGER`  | no       | *(latest ledger)*                    | First ledger to index on a fresh database. Must fall inside the RPC node's retention window. Ignored once a cursor exists. |

Example `indexer/.env`:

```bash
DATABASE_URL=postgresql://prism:prism@localhost:5432/prism
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
POLL_INTERVAL_MS=5000
```

## Docker Compose (repo root)

Compose reads these from the root `.env` (copy `.env.example` to `.env`).

| Name                  | Required | Default | Description |
| --------------------- | -------- | ------- | ----------- |
| `POSTGRES_PASSWORD`   | no       | `prism` | Password for the `prism` Postgres user. **Change it for any non-local deployment.** |
| `NEXT_PUBLIC_NETWORK` | no       | `testnet` | Passed through to the frontend. |
| `NEXT_PUBLIC_HORIZON_URL` | no   | testnet Horizon URL | Passed through to the frontend. |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | no | testnet Soroban RPC URL | Passed through to the frontend **and** used as the indexer's `SOROBAN_RPC_URL`. |
| `NEXT_PUBLIC_SITE_URL`| no       | `http://localhost:3000` | Passed through to the frontend. |
| `DATABASE_URL`        | no       | `postgresql://prism:prism@postgres:5432/prism` | Overrides the frontend's database connection. |
| `DATABASE_POOL_MAX`   | no       | `10`    | Passed through to the frontend. |
| `DATABASE_IDLE_TIMEOUT_MS` | no  | `10000` | Passed through to the frontend. |
| `DATABASE_SSL`        | no       | `false` | Passed through to the frontend. |

Example root `.env`:

```bash
POSTGRES_PASSWORD=change-me
NEXT_PUBLIC_NETWORK=testnet
```

## Related

- [docs/troubleshooting.md](docs/troubleshooting.md) — diagnosing misconfigured
  variables (Postgres, RPC 429s, "indexer not available").
- [GLOSSARY.md](GLOSSARY.md) — definitions for the Soroban terms above.