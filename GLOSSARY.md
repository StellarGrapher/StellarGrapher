# Soroban Glossary

Plain-language definitions for the Soroban- and Stellar-specific terms used
throughout Prism. Each entry links to the official Stellar/Soroban docs for
more depth.

> The authoritative reference is the [Soroban documentation](https://soroban.stellar.org/docs)
> and the [Stellar developer docs](https://developers.stellar.org/docs).

## Ledger and network

- **Ledger** — A block in the Stellar network. Ledgers close roughly every 5
  seconds and are numbered by a monotonically increasing **sequence**.
- **Ledger sequence** — The number identifying a ledger. Prism URLs like
  `/ledger/12345` use it.
- **Ledger entry** — A single stored item in the global ledger state (an
  account, a contract's storage, a contract's WASM code, etc.). Entries have a
  type and a key.
- **Network passphrase** — A string that identifies which network a transaction
  is signed for (e.g. `Test SDF Network ; September 2015`). Signing with the
  wrong passphrase produces signatures the network rejects. See
  `Networks` in the Stellar SDK.
- **Horizon** — The Stellar REST API server. Prism uses it for classic
  operations, ledgers, transactions, and accounts.
- **Soroban RPC** — The JSON-RPC server that exposes contract data, events, and
  simulation. Prism uses it for contract storage, invocation history, and
  dry-runs. Public nodes retain only ~24 h of events.

## Accounts and addresses

- **Account address** — A Stellar account's public key in `G...` **strkey**
  form (an ED25519 public key).
- **Contract ID** — A deployed contract's address in `C...` **strkey** form.
- **StrKey** — Stellar's base32 encoding (with a version byte and checksum) used
  for addresses, contract IDs, and other binary identifiers.
- **Muxed account** — An account address that also carries a 64-bit id, encoded
  as an `M...` strkey, used to distinguish sub-accounts of one account.

## Contracts and WASM

- **Smart contract** — A program deployed to Soroban, identified by its
  **contract ID**.
- **WASM** — WebAssembly, the binary format Soroban contracts are compiled to
  and run as. Prism can fetch a contract's WASM and parse its embedded spec.
- **Contract spec / ABI** — The interface a contract publishes inside its WASM
  (functions, types, events). Prism reads it from the `contractspecv0` custom
  section to render human-readable names.
- **`ScSpecEntry`** — One record in a contract's spec (a function, a type
  definition, or an event declaration).
- **Host function** — A function the Soroban host exposes to contracts
  (storage, crypto, ledger access, etc.). A contract call is an
  `InvokeHostFunction` operation.
- **Invocation** — One execution of a contract function within a transaction.
  A transaction may contain several.
- **Authorization (`require_auth`)** — A contract's check that the holder of an
  address approved the call. Prism shows failed authorizations as errors.

## Storage and state

- **Storage** — A contract's persistent key/value state, held in **ledger
  entries**.
- **Durability** — How long a storage entry lives:
  - **Instance** — the contract's own metadata and small shared state; lives as
    long as the contract.
  - **Persistent** — long-lived key/value data that must be kept alive
    explicitly.
  - **Temporary** — short-lived data that can expire and be pruned; cheaper.
- **TTL (time-to-live)** — The number of ledgers an entry is kept alive for.
  Entries expire when their TTL runs out unless extended.
- **`extend_ttl` / bump** — A host call that extends an entry's TTL (and pays
  the rent for doing so). Contracts call it to keep hot entries alive.
- **Rent / storage fee** — The ongoing cost, paid in ledger entries' TTL, of
  keeping data on-chain. Longer TTLs cost more.
- **Footprint** — The set of ledger entries a transaction reads and writes.
  Soroban transactions declare their footprint up front.
- **Resource fee** — The fee a transaction pays for the resources its footprint
  consumes (CPU instructions, memory, disk reads/writes), separate from the
  base fee.

## Values and decoding

- **`ScVal`** — Soroban's universal value type (the "Smart Contract Value").
  Every contract argument, return value, storage key/value, and event payload
  is an `ScVal`. It is self-describing in XDR but not in raw base64.
- **XDR** — External Data Representation, Stellar's binary encoding. Prism's
  `/xdr` decoder identifies and decodes raw base64 XDR.
- **Contract event** — A log record a contract emits during execution. An event
  has a name, **topics**, and a **data payload**.
- **Topic** — An indexed field of an event, used for filtering. In Soroban's
  typed events, some fields ride in the topic list and the rest in the data.
- **Data payload** — The non-indexed part of an event. Depending on the event's
  declared `data_format` it is a `map`, a `vec` (positional), or a
  `single-value`.
- **Contract error** — A numeric error code a contract returns from its own
  `#[contracterror]` enum. Prism maps it back to the enum's name using the
  contract's spec.

## Prism-specific

- **Indexer** — Prism's optional forward-only service that polls Soroban RPC
  and persists deployments, invocations, storage changes, and events into
  Postgres, removing the RPC retention limit and enabling full storage-key
  enumeration.
- **Cursor-based pagination** — How Prism pages history: a cursor names the
  last row of a page (by ledger and id) and the next page starts strictly after
  it. See [ADR 0001](adr/0001-cursor-based-pagination.md).