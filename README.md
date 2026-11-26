# Prism

Prism is a Soroban-native block explorer for the Stellar network. While existing explorers like stellar.expert cover classic Stellar operations, they have limited or no support for Soroban-specific data contract storage, invocation history, emitted events, and WASM bytecode. Prism exposes all of this in a clean, fast, open-source interface.

---

## Why Prism

The Stellar Development Foundation identified explorer support for Soroban as a critical missing piece of infrastructure:

> *"Soroban needs explorers that can retrieve data about smart contracts."*

When a developer deploys a Soroban contract, they need to inspect its storage state, trace invocation history, debug failed transactions, and monitor emitted events. None of this is possible with current explorers. Prism is built to fill that gap as a community-owned, open-source tool.

---

## Features

### Contract Explorer
- View deployed contract WASM bytecode and metadata
- Inspect live contract storage (persistent, temporary, and instance storage)
- Browse full invocation history with inputs and outputs
- View all emitted contract events with filtering

### Transaction Explorer
- Detailed transaction breakdown with Soroban-specific operation decoding
- Transaction simulation and dry-run from the UI
- Fee and resource usage breakdown (CPU instructions, memory, ledger reads/writes)
- Failed transaction debugging with error messages

### Ledger & Network
- Auto-refreshing ledger overview (polls every 6 seconds — no streaming connection)
- Network statistics (TPS, ledger close time, active contracts)
- Search by transaction hash, contract ID, account address, or ledger sequence

### Developer Tools
- In-browser contract invocation (call any contract function directly from Prism)
- ABI/interface display for verified contracts
- XDR decoder for raw transaction data at `/xdr` — paste any base64 blob and Prism identifies the type (transaction envelope, result, meta, ledger entry/key, contract spec entry, or ScVal) before decoding it

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Browser (Next.js)                 │
│   Contract View  │  Tx Explorer  │  Dev Tools       │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│                  Prism API (Next.js API routes)      │
└──────────────────┬───────────────────┬──────────────┘
                   │                   │
         ┌─────────┴──────────┐        │ (optional)
         │                    │        │
┌────────▼──────┐   ┌─────────▼────────┐  ┌──▼──────────────┐
│ Stellar Horizon│   │  Soroban RPC     │  │  Postgres        │
│ (classic ops) │   │  (contract data) │  │  (indexed data)  │
└───────────────┘   └────────┬─────────┘  └──▲──────────────┘
                              │                │
                    ┌─────────▼────────────────┴──┐
                    │  indexer/ (forward-only)     │
                    │  polls Soroban RPC, persists │
                    │  storage/invocations/events  │
                    └───────────────────────────────┘
```

The repository is three parts: `frontend/` (the explorer itself), `indexer/` (an optional service described below), and `contracts/` — Soroban contracts that exist to be looked at. `contracts/showcase` deliberately uses every feature the explorer renders (all three storage durabilities, typed events, the full range of ScVal shapes in its ABI, and a function that always fails), so each panel can be verified against a contract you control instead of hunting for a mainnet one that happens to exercise it. See [contracts/README.md](./contracts/README.md) for the deploy recipe.

The frontend works standalone against public RPC/Horizon endpoints — no database required. That gets you live chain state but is bounded by the RPC node's retention window (~24h) for events/history, and there's no way to enumerate a contract's storage keys via RPC at all (no such method exists). Running the optional `indexer/` service alongside it removes both limits for data observed since the indexer started: full invocation/event history and genuine storage-key enumeration, not just point lookups. It's forward-only by design — no historical backfill from before it started running.

---

## Self-Hosting

Standalone (frontend only, no database):

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Full stack, including the indexer for full storage enumeration and unbounded history:

```bash
docker compose up
```

This runs Postgres, the indexer (`indexer/`), and the frontend together — see [Architecture](#architecture) above for what running the indexer actually buys you.

The Postgres port is published only on `127.0.0.1`. Compose uses `prism` as a local-development-only default for `POSTGRES_PASSWORD`; set a strong value in your environment before starting the stack if you need a different password. Do not use the default for a production deployment.

### Running against a local network (stellar-quickstart)

If you're building Soroban contracts, you can run Prism against a local network instead of testnet or mainnet. [stellar-quickstart](https://github.com/stellar/stellar-quickstart) spins up a complete local Stellar network (Horizon, Soroban RPC, and a friendbot) in Docker, so you can deploy and inspect contracts without touching a public network.

**1. Start stellar-quickstart.**

```bash
docker run --rm -p 8000:8000 stellar/quickstart:latest \
  --local \
  --enable-soroban-rpc
```

This exposes:

- Horizon at `http://localhost:8000`
- Soroban RPC at `http://localhost:8000/soroban/rpc`
- Friendbot at `http://localhost:8000/friendbot`

Wait until the container logs report the network is up before continuing.

**2. Point Prism at the local network.**

In `frontend/.env.local`, set the RPC and Horizon URLs to the quickstart endpoints:

```bash
NEXT_PUBLIC_SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc
NEXT_PUBLIC_HORIZON_URL=http://localhost:8000
```

Then start the frontend:

```bash
cd frontend
npm run dev
```

Prism now reads live chain state from your local network. If you're running the full stack with the indexer, point the indexer's RPC/Horizon settings at the same URLs so it indexes the local network too.

**3. Deploy the showcase contract.**

Fund a local account with friendbot, then build and deploy `contracts/showcase` to the local network:

```bash
# Fund a local identity
curl "http://localhost:8000/friendbot?addr=$(stellar keys address local)"

# Build and deploy the showcase contract
cd contracts/showcase
stellar contract build
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/showcase.wasm \
  --source local \
  --network local
```

See [contracts/README.md](./contracts/README.md) for the full deploy recipe and the functions the showcase contract exposes.

**4. Inspect it in Prism.**

Open `http://localhost:3000` and search for the contract ID printed by the deploy command. You can now browse its storage, invocation history, and emitted events against your local network.

### Rate limits and reverse proxies

Every `/api/*` route is rate-limited per client: 30 requests per minute, except `/api/contract/[id]/simulate` at 10 per minute. Each route keeps its own counter, so hitting the limit on one route doesn't block the others. Over the limit, the API returns `429` with a `Retry-After` header (in seconds).

**How a client is identified.** Prism has no trusted-proxy setting. It takes the **first (leftmost) entry of the `X-Forwarded-For` header** as the client's address, and uses nothing else, not even the socket address. This has three consequences:

- A request with no `X-Forwarded-For` header is counted as the client `unknown`. Every such request shares one counter, so if nothing sets the header, everyone hits the limit together.
- Prism trusts whatever the header says. If clients can reach Prism directly, or through a proxy that *appends* to the header instead of replacing it, they can put any address first and get around the limit.
- The limiter keeps its counters in memory, one set per process. They're lost on restart, and with N replicas a client effectively gets N times the limit.

**Proxy configuration.** Put Prism behind a reverse proxy that **overwrites** `X-Forwarded-For` with the real client address, and make sure the proxy is the only way to reach Prism. For example, bind port 3000 to localhost or an internal network instead of publishing it.

nginx — set the header to the peer address instead of using `$proxy_add_x_forwarded_for`, which appends:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Caddy — `reverse_proxy` only keeps incoming `X-Forwarded-For` values from addresses listed in `trusted_proxies`. With none listed, which is the default, it replaces the header with the peer address:

```caddy
explorer.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

With more than one proxy, such as a CDN or load balancer in front of nginx, the outermost hop has to set the header and every inner hop has to pass it on without appending. With nginx, use `real_ip_header X-Forwarded-For` and `set_real_ip_from <upstream range>` so that `$remote_addr` becomes the original client, then set the header to it as shown above. Cloudflare provides the client address in `CF-Connecting-IP`. Behind Cloudflare, use `proxy_set_header X-Forwarded-For $http_cf_connecting_ip;`, but only if Prism's origin accepts traffic from Cloudflare alone.

To check the setup, send about 35 requests in a minute to a read route from one machine, for example `curl -s -o /dev/null -w '%{http_code}\n' https://explorer.example.com/api/ledger/1`. From around the 31st request you should get `429`. A second machine should still get `200` during that time. If the second machine also gets `429`, every client is sharing one counter: the header isn't reaching Prism, or it holds the proxy's own address.

---

## Roadmap

- [x] Ledger overview with auto-refreshing updates
- [x] Transaction explorer with Soroban decoding
- [x] Contract storage inspector
- [x] Contract invocation history and event log
- [x] In-browser contract invocation tool
- [x] XDR decoder
- [x] Docker Compose for self-hosting
- [x] Optional indexer for full storage enumeration and unbounded history
- [x] Showcase contract for end-to-end verification of every explorer panel
- [ ] Mainnet deployment at prism.network

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to get started. Frontend, RPC integration, indexer, and Soroban contract contributions are all needed.

New contributors can follow the [first-PR walkthrough](./docs/onboarding.md).

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/onboarding.md](./docs/onboarding.md) | First pull request walkthrough (frontend, indexer, contracts). |
| [docs/api-reference.md](./docs/api-reference.md) | The JSON API and its rate-limiting/back-off model. |
| [docs/troubleshooting.md](./docs/troubleshooting.md) | Common self-hosting issues and fixes. |
| [ENVIRONMENT.md](./ENVIRONMENT.md) | Every environment variable, with defaults. |
| [GLOSSARY.md](./GLOSSARY.md) | Soroban and Stellar terms in plain language. |
| [adr/](./adr/README.md) | Architecture decision records. |
| [indexer/README.md](./indexer/README.md) | Indexer flow diagram and database schema. |
| [contracts/README.md](./contracts/README.md) | Showcase contract function reference. |

## License

MIT — see [LICENSE](./LICENSE).
