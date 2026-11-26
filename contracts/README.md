# Prism Contracts

Soroban contracts that give the explorer something real to inspect.

`showcase/` deliberately uses every storage durability, all three event data
formats, varied ABI values, authorization, and a predictable contract error.

## Contracts

| Crate | What it exercises |
| --- | --- |
| [`showcase`](./showcase) | Instance, persistent, and temporary storage; typed map, vec, and single-value events; compound ABI values; and a deliberate error. |

### What `showcase` exercises

- **Instance storage** — `admin` and a counter.
- **Persistent storage** — keyed notes plus standalone `Vec<i128>` and
  `Map<Symbol, String>` entries.
- **Temporary storage** — per-address session markers that expire on their own.
- **Events** — seven typed events. Most use map data, `AmountsTallied` uses vec
  data, and `CounterValue` uses single-value data.
- **ABI surface** — `u32`, `i128`, `Symbol`, `String`, `Address`, `Bytes`,
  `Vec<T>`, `Map<K, V>`, `Option<T>`, struct returns, and a contract enum.
- **Failure** — `boom()` always returns `Error::Deliberate`.

## Showcase contract reference

Full reference for `contracts/showcase/src/lib.rs`. Durability abbreviations:
**I** = instance, **P** = persistent, **T** = temporary.

### Storage keys (`DataKey`)

| Key                 | Durability | Type                       | Written by                          |
| ------------------- | ---------- | -------------------------- | ----------------------------------- |
| `Admin`             | I          | `Address`                  | `init`                              |
| `Counter`           | I          | `u32`                      | `init`, `bump`                      |
| `Note(Symbol)`      | P          | `Note`                     | `put_note`, removed by `delete_note`|
| `Values`            | P          | `Vec<i128>`                | `store_collections`                 |
| `Labels`            | P          | `Map<Symbol, String>`      | `store_collections`                 |
| `Session(Address)`  | T          | `u32` (expiry ledger)      | `start_session`                     |

`Note` is `{ author: Address, body: String, revision: u32 }`. Persistent and
temporary entries are kept alive with `extend_ttl(30 days, 90 days)`; sessions
use `extend_ttl(ledgers, ledgers)`. Notes are capped at `MAX_NOTE_LEN = 200`
bytes.

### Errors (`Error`)

| Code | Name               | Raised by                             |
| ---- | ------------------ | ------------------------------------- |
| 1    | `AlreadyInitialized` | `init` when already initialized     |
| 2    | `NotInitialized`   | reads before `init`                   |
| 3    | `NoteTooLong`      | `put_note` body over 200 bytes        |
| 4    | `NoSuchNote`       | `note` / `delete_note` on a missing name |
| 5    | `Deliberate`       | `boom` (always)                       |

### Functions

| Function | Inputs | Output | Side effects |
| -------- | ------ | ------ | ------------ |
| `init` | `admin: Address` | `Result<(), Error>` | Writes `Admin` and `Counter=0` (instance). Emits `Initialized`. Errors if already initialized. |
| `admin` | — | `Result<Address, Error>` | Reads `Admin`. `NotInitialized` before `init`. |
| `bump` | `by: u32` | `u32` | Reads/sets `Counter` (saturating add), extends its TTL. Emits `Bumped` and `CounterValue`. Returns the new counter. |
| `put_note` | `author: Address`, `name: Symbol`, `body: String` | `Result<u32, Error>` | `author.require_auth()`. Writes `Note(name)` with `revision+1`, extends TTL. Emits `NoteWritten`. Returns the revision. `NoteTooLong` if body > 200 bytes. |
| `note` | `name: Symbol` | `Result<Note, Error>` | Reads `Note(name)`, extends TTL. `NoSuchNote` if absent. |
| `delete_note` | `name: Symbol` | `Result<(), Error>` | `admin.require_auth()`. Removes `Note(name)`. Emits `NoteDeleted`. `NoSuchNote` if absent. |
| `start_session` | `who: Address`, `ledgers: u32` | `()` | Writes `Session(who)=expiry` (temporary), extends TTL to `ledgers` (min 1). Emits `SessionStarted`. |
| `session` | `who: Address` | `Option<u32>` | Reads `Session(who)` expiry ledger, if still live. |
| `revisions` | `names: Vec<Symbol>` | `Map<Symbol, u32>` | Reads each `Note(name)`; unknown names are skipped. |
| `store_collections` | `values: Vec<i128>`, `labels: Map<Symbol, String>` | `()` | Writes `Values` and `Labels` (persistent), extends both TTLs. |
| `stored_values` | — | `Vec<i128>` | Reads `Values` (empty vec if unset). |
| `stored_labels` | — | `Map<Symbol, String>` | Reads `Labels` (empty map if unset). |
| `tally` | `amounts: Vec<i128>` | `i128` | Sums with saturation. Emits `AmountsTallied` (vec data). Returns the total. |
| `checksum` | `blob: Bytes` | `u32` | XORs every byte. Pure; no storage, no events. |
| `stats` | — | `Result<Stats, Error>` | Reads `Counter` and `Admin`. Returns `Stats { counter, admin, contract }` where `contract` is the contract's own address. `NotInitialized` before `init`. |
| `boom` | — | `Result<(), Error>` | Always returns `Err(Error::Deliberate)`. |

### Events

Default data format is `map` (data keyed by field name); `#[topic]` fields ride
in the topic list. `AmountsTallied` uses `vec` (positional) data and
`CounterValue` uses `single-value` data.

| Event | Topics | Data | Emitted by |
| ----- | ------ | ---- | ---------- |
| `Initialized` | `admin: Address` | *(none)* | `init` |
| `Bumped` | *(none)* | `counter: u32` (map) | `bump` |
| `NoteWritten` | `name: Symbol`, `author: Address` | `revision: u32` (map) | `put_note` |
| `NoteDeleted` | `name: Symbol` | *(none)* | `delete_note` |
| `SessionStarted` | `who: Address` | `expires_at: u32` (map) | `start_session` |
| `AmountsTallied` | *(none)* | `[count: u32, total: i128]` (vec) | `tally` |
| `CounterValue` | *(none)* | `counter: u32` (single-value) | `bump` |

## Local development

Run commands from the repository root. Each command below includes a typical
successful result; timing and compiler progress can differ by machine.

```bash
cd contracts
```

Example output:

```text
(no output; current directory is now contracts/)
```

```bash
cargo test
```

Example output:

```text
running 23 tests
test result: ok. 23 passed; 0 failed; 0 ignored
```

```bash
cargo fmt --all -- --check
```

Example output:

```text
(no output; exit status 0)
```

```bash
cargo clippy --all-targets -- -D warnings
```

Example output:

```text
Finished `dev` profile [unoptimized + debuginfo] target(s)
```

```bash
stellar contract build
```

Example output:

```text
ℹ️  Build Complete
```

The pinned Rust toolchain installs `wasm32v1-none`, rustfmt, and clippy. Tests
also write ledger snapshots to `showcase/test_snapshots/`; those snapshots are
committed so state changes are visible in review.

## Self-Hosting

Run Prism against a local network so you can iterate on Soroban contracts
without waiting on testnet ingestion. This guide uses
[`stellar-quickstart`](https://github.com/stellar/stellar-quickstart) for the
local network and the `showcase` contract as sample activity.

### 1. Start a local network with Docker

```bash
docker run --rm -it \
  --name stellar-quickstart \
  -p 8000:8000 \
  stellar/quickstart:latest \
  --local --enable-soroban-rpc
```

Example output:

```text
Starting Stellar Quickstart
...
Soroban RPC is running at http://localhost:8000/soroban/rpc
```

This exposes the Horizon API at `http://localhost:8000` and Soroban RPC at
`http://localhost:8000/soroban/rpc`. Leave the container running in its own
terminal.

### 2. Point Prism at the local network

Start Prism with the local RPC and network passphrase. From the repository
root:

```bash
NEXT_PUBLIC_STELLAR_NETWORK=local \
NEXT_PUBLIC_SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc \
NEXT_PUBLIC_HORIZON_URL=http://localhost:8000 \
NEXT_PUBLIC_NETWORK_PASSPHRASE="Standalone Network ; February 2017" \
npm run dev
```

Example output:

```text
▲ Next.js ready on http://localhost:3000
```

Open `http://localhost:3000` and confirm the network indicator shows the local
network.

### 3. Deploy the showcase contract locally

Create and fund a local identity, then build and deploy the contract against
the local network:

```bash
stellar keys generate --global local --network local --fund
```

Example output:

```text
✅ Funded account local on local
```

```bash
stellar contract build
```

Example output:

```text
ℹ️  Build Complete
```

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/prism_showcase.wasm \
  --source local --network local
```

Example output:

```text
CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

Save that value as `CONTRACT_ID`, then initialize the contract and generate
sample activity:

```bash
stellar contract invoke --id "$CONTRACT_ID" --source local --network local \
  -- init --admin "$(stellar keys address local)"

stellar contract invoke --id "$CONTRACT_ID" --source local --network local \
  -- bump --by 7

stellar contract invoke --id "$CONTRACT_ID" --source local --network local \
  -- put_note --author "$(stellar keys address local)" --name hello --body "first revision"

stellar contract invoke --id "$CONTRACT_ID" --source local --network local \
  -- tally --amounts '[10,20,12]'
```

Example output:

```text
null
7
1
42
```

### 4. Inspect the contract in Prism

Open the contract page in your local Prism instance:

```text
http://localhost:3000/contract/<CONTRACT_ID>
```

Because the local network produces ledgers immediately, storage, events, and
invocations appear without the ingestion delay of a public network. To reset,
stop the `stellar-quickstart` container and start it again from step 1.

## Automated testnet deployment

The deployment script creates and funds `prism-showcase` when that identity is
missing, builds and deploys the WASM, initializes it, and invokes representative
storage and event functions.

```bash
./deploy-showcase-testnet.sh
```

Example output:

```text
Creating and funding Stellar identity 'prism-showcase' on testnet...
Building the showcase contract...
Deploying the showcase contract...
Initializing and generating sample activity...
Contract ID: CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
Prism URL: https://prism-gules.vercel.app/contract/CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

Override `SOURCE_ACCOUNT`, `NETWORK`, or `PRISM_URL` when needed. The final URL
is ready to open at `/contract/<CONTRACT_ID>` after network ingestion catches
up.

## Manual testnet recipe

The following is the same flow broken into inspectable steps.

```bash
stellar keys generate --global alice --network testnet --fund
```

Example output:

```text
✅ Funded account alice on testnet
```

```bash
stellar contract build
```

Example output:

```text
ℹ️  Build Complete
```

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/prism_showcase.wasm \
  --source alice --network testnet
```

Example output:

```text
CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

Save that value as `CONTRACT_ID`, then initialize the contract:

```bash
stellar contract invoke --id "$CONTRACT_ID" --source alice --network testnet \
  -- init --admin "$(stellar keys address alice)"
```

Example output:

```text
null
```

Create instance storage plus map-format and single-value events:

```bash
stellar contract invoke --id "$CONTRACT_ID" --source alice --network testnet \
  -- bump --by 7
```

Example output:

```text
7
```

Create keyed persistent storage and a map-format event with two indexed topics:

```bash
stellar contract invoke --id "$CONTRACT_ID" --source alice --network testnet \
  -- put_note --author "$(stellar keys address alice)" --name hello --body "first revision"
```

Example output:

```text
1
```

Create persistent Vec and Map entries:

```bash
stellar contract invoke --id "$CONTRACT_ID" --source alice --network testnet \
  -- store_collections --values '[1,2,3]' \
  --labels '{"environment":"testnet","purpose":"showcase"}'
```

Example output:

```text
null
```

Emit a vec-format event:

```bash
stellar contract invoke --id "$CONTRACT_ID" --source alice --network testnet \
  -- tally --amounts '[10,20,12]'
```

Example output:

```text
42
```

Create temporary storage:

```bash
stellar contract invoke --id "$CONTRACT_ID" --source alice --network testnet \
  -- start_session --who "$(stellar keys address alice)" --ledgers 200
```

Example output:

```text
null
```

Finally, create a failed invocation for Prism's error renderer:

```bash
stellar contract invoke --id "$CONTRACT_ID" --source alice --network testnet \
  -- boom
```

Expected output (this command intentionally exits non-zero):

```text
error: HostError: Error(Contract, #5)
```
