# Prism API Reference

Prism's frontend exposes a small, read-only JSON API under `/api/*`. It is the
same API the explorer UI calls, so it is stable enough to build against. This
page documents the available endpoints and, in detail, the rate-limiting model
downstream consumers must implement back-off around.

All responses are JSON. Errors use an `{ "error": "..." }` (or route-specific)
shape with an appropriate HTTP status code.

## Endpoints

| Method | Path                                   | Description                                                        |
| ------ | -------------------------------------- | ------------------------------------------------------------------ |
| `GET`  | `/api/ledger/[seq]`                    | A single ledger by sequence number.                                |
| `GET`  | `/api/tx/[hash]`                       | A single transaction by hash.                                      |
| `GET`  | `/api/contract/[id]`                   | Contract metadata: executable, storage summary, deployment info.   |
| `GET`  | `/api/contract/[id]/storage`           | Point lookups of contract storage by key.                          |
| `GET`  | `/api/contract/[id]/storage/full`      | Full storage-key enumeration (requires the indexer).               |
| `GET`  | `/api/contract/[id]/invocations`       | Paginated invocation history (cursor-based).                       |
| `GET`  | `/api/contract/[id]/events`            | Paginated emitted events (cursor-based).                           |
| `GET`  | `/api/contract/[id]/wasm`              | WASM bytecode size and parsed ABI/spec.                            |
| `POST` | `/api/contract/[id]/simulate`          | Read-only contract simulation (dry run).                           |

Paginated endpoints accept `?limit=` and `?cursor=` query parameters; see
[ADR 0001](../adr/0001-cursor-based-pagination.md) for why pagination is
cursor-based rather than offset-based.

## Rate limiting

Every `/api/*` route is rate-limited **per client** with a fixed-window counter.
Each route keeps its own counter, so exhausting the limit on one route does not
block the others. Counters live in memory, one set per process.

### Limits per endpoint group

| Endpoint group                                   | Scope (counter key)        | Limit      |
| ------------------------------------------------ | -------------------------- | ---------- |
| `/api/ledger/[seq]`                              | `ledger`                   | 30 / min   |
| `/api/tx/[hash]`                                 | `tx`                       | 30 / min   |
| `/api/contract/[id]`                             | `contract-info`            | 30 / min   |
| `/api/contract/[id]/storage`                     | `contract-storage`         | 30 / min   |
| `/api/contract/[id]/storage/full`                | `contract-storage-full`    | 30 / min   |
| `/api/contract/[id]/invocations`                 | `contract-invocations`     | 30 / min   |
| `/api/contract/[id]/events`                      | `contract-events`          | 30 / min   |
| `/api/contract/[id]/wasm`                        | `contract-wasm`            | 30 / min   |
| `/api/contract/[id]/simulate`                    | `contract-simulate`        | **10 / min** |

The window is 60 seconds for every scope.

### How a client is identified

Prism takes the **first (leftmost) entry of the `X-Forwarded-For` header** as
the client address, and nothing else. A request with no `X-Forwarded-For` header
is counted as the shared client `unknown` (or `direct` when `TRUST_PROXY` is
unset), so every such request shares one counter. Deploy behind a reverse proxy
that overwrites `X-Forwarded-For` with the real client address; see the
[README rate-limit section](../README.md#rate-limits-and-reverse-proxies).

### Response headers

When a request is over the limit the API responds with HTTP `429` and a
`Retry-After` header giving the number of seconds until the window resets:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 42

{ "error": "Rate limit exceeded. Try again shortly." }
```

`Retry-After` is always an integer number of **seconds** (for example `42`). It
is only present on `429` responses.

### Recommended retry strategy

Honour `Retry-After` when it is present; otherwise fall back to exponential
back-off with jitter. Do not retry a `429` immediately in a tight loop — that
keeps the counter saturated and prolongs the block.

```text
function requestWithBackoff(method, path, body):
    attempt = 0
    base = 1            # seconds
    cap  = 60           # seconds
    loop:
        res = httpRequest(method, path, body)

        if res.status != 429:
            return res

        # Prefer the server's hint; otherwise exponential back-off with jitter.
        if res has header "Retry-After":
            delay = parseSeconds(res.header["Retry-After"])
        else:
            delay = min(cap, base * 2 ** attempt)
            delay = delay + random(0, delay * 0.5)   # full-ish jitter

        sleep(delay)
        attempt = attempt + 1
```

Notes:

- `Retry-After` (seconds) is authoritative when present — use it verbatim.
- Cap the delay (for example at 60 s) and cap the number of attempts so a
  persistently failing dependency does not retry forever.
- Add jitter so that many clients that were blocked together do not retry in
  lockstep and re-saturate the window.
- A `429` is not an error in the request — it is a signal to wait. A `5xx` is a
  genuine server/RPC problem and should be surfaced to the caller.