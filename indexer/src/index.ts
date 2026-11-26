import { rpc, encodeMuxedAccountToAddress, type xdr } from "@stellar/stellar-sdk";
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { Registry, Counter, Gauge, collectDefaultMetrics } from "prom-client";
import type { Prisma } from "@prisma/client";
import { prisma, findCursor, seedCursor, setCursor, type Db } from "./db.js";
import { log } from "./logger.js";
import {
  contractCreatedEvent,
  decodeContractCreation,
  decodeInvocation,
  extractEvents,
  extractInvocationReturnValue,
  extractStorageChanges,
} from "./decode.js";
import { retryDeadLetterEvent } from "./dead-letter.js";
import type { DeadLetterStage } from "./dead-letter.js";

// ---------------------------------------------------------------------------
// Environment variable validation (#20)
// ---------------------------------------------------------------------------
function requireEnv(name: string, fallback?: string): string {
  const val = process.env[name] ?? fallback;
  if (val === undefined) {
    log.error("environment variable is required but not set", { envVar: name, fatal: true });
    process.exit(1);
  }
  return val;
}

function requirePositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    log.error("environment variable must be a positive integer", { envVar: name, value: raw, fatal: true });
    process.exit(1);
  }
  return n;
}

/**
 * Parse INDEXER_CONTRACT_IDS: comma-separated contract IDs. Empty or unset means
 * index every contract. Returns null for "no filter".
 */
export function parseContractIds(raw: string | undefined): Set<string> | null {
  if (raw === undefined || raw.trim() === "") return null;
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  if (ids.length === 0) return null;
  for (const id of ids) {
    if (!/^C[A-Z2-7]{55}$/.test(id)) {
      log.error("INDEXER_CONTRACT_IDS contains an invalid contract ID", {
        envVar: "INDEXER_CONTRACT_IDS",
        value: id,
        fatal: true,
      });
      process.exit(1);
    }
  }
  return new Set(ids);
}

const RPC_URL = requireEnv("SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org");
const POLL_INTERVAL_MS = requirePositiveInt("INDEXER_POLL_INTERVAL_MS", 6000);
const HEALTH_PORT = requirePositiveInt("HEALTH_PORT", 8080);
const MAX_LEDGER_LAG = requirePositiveInt("HEALTH_MAX_LEDGER_LAG", 60);
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
export const CONTRACT_IDS = parseContractIds(process.env.INDEXER_CONTRACT_IDS);
export const PAGE_LIMIT = 50;

/** True when the contract passes the optional INDEXER_CONTRACT_IDS filter. */
export function isIndexedContract(
  contractId: string,
  filter: Set<string> | null = CONTRACT_IDS
): boolean {
  return filter === null || filter.has(contractId);
}

// ---------------------------------------------------------------------------
// Prometheus metrics (#23)
// ---------------------------------------------------------------------------
export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

export const metricLedgersProcessed = new Counter({
  name: "indexer_ledgers_processed_total",
  help: "Total number of ledgers processed by the indexer",
  registers: [metricsRegistry],
});

export const metricRowsWritten = new Counter({
  name: "indexer_rows_written_total",
  help: "Total rows written, partitioned by table",
  labelNames: ["table"] as const,
  registers: [metricsRegistry],
});

export const metricLag = new Gauge({
  name: "indexer_ledger_lag",
  help: "Current lag between the indexer cursor and the network latest ledger",
  registers: [metricsRegistry],
});

export const metricPollErrors = new Counter({
  name: "indexer_poll_errors_total",
  help: "Total number of poll errors encountered",
  registers: [metricsRegistry],
});

export const metricDeadLetterQueueSize = new Gauge({
  name: "indexer_dead_letter_queue_size",
  help: "Number of unresolved dead-letter events awaiting retry",
  registers: [metricsRegistry],
});

export const metricDeadLetterEvents = new Counter({
  name: "indexer_dead_letter_events_total",
  help: "Total dead-letter events recorded, partitioned by stage",
  labelNames: ["stage"] as const,
  registers: [metricsRegistry],
});

export const server = new rpc.Server(RPC_URL, { timeout: 10_000 });

let stopping = false;
let wakeFromSleep = (): void => {};

/** Sleep that a shutdown signal can cut short. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wakeFromSleep = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

/**
 * Delay before the next poll after `failures` consecutive failures: exponential
 * from BACKOFF_BASE_MS, capped at BACKOFF_MAX_MS. Equal jitter draws each delay
 * from the upper half of its step, so the range keeps growing with each failure.
 */
export function backoffDelay(failures: number, random: () => number = Math.random): number {
  const step = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
  return Math.round(step / 2 + random() * (step / 2));
}

export interface HealthSnapshot {
  cursor: number;
  latestLedger: number;
  lastPollFailed: boolean;
}

/** Unhealthy when the last poll failed or the cursor trails the network by more than maxLag ledgers. */
export function healthReport(snapshot: HealthSnapshot, maxLag: number) {
  const lag = Math.max(0, snapshot.latestLedger - snapshot.cursor);
  const healthy = !snapshot.lastPollFailed && lag <= maxLag;
  return { healthy, ...snapshot, lag };
}

/**
 * The last-processed ledger to seed a fresh cursor with. Without INDEXER_START_LEDGER
 * that is the network's latest ledger. With it, indexing begins at that ledger, which
 * must lie inside the RPC node's retention window or the poll would hit the gap branch.
 */
export function seedLastLedger(
  raw: string | undefined,
  network: { latestLedger: number; oldestLedger: number }
): number {
  if (raw === undefined || raw.trim() === "") return network.latestLedger;
  const start = Number(raw);
  if (!Number.isSafeInteger(start) || start < 1) {
    throw new Error(`INDEXER_START_LEDGER must be a positive integer, got "${raw}"`);
  }
  if (start < network.oldestLedger || start > network.latestLedger) {
    throw new Error(
      `INDEXER_START_LEDGER ${start} is outside the RPC node's retention window ` +
        `(ledgers ${network.oldestLedger}-${network.latestLedger})`
    );
  }
  return start - 1;
}

const health: HealthSnapshot = { cursor: 0, latestLedger: 0, lastPollFailed: false };

function startHealthServer(): Server {
  const httpServer = createServer(async (req, res) => {
    const path = req.url?.split("?")[0];
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    if (path === "/healthz") {
      const report = healthReport(health, MAX_LEDGER_LAG);
      res.writeHead(report.healthy ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify(report));
      return;
    }
    if (path === "/metrics") {
      const metrics = await metricsRegistry.metrics();
      res.writeHead(200, { "content-type": metricsRegistry.contentType });
      res.end(metrics);
      return;
    }
    res.writeHead(404).end();
  });
  httpServer.listen(HEALTH_PORT, () => {
    log.info("health endpoint listening", { port: HEALTH_PORT, routes: ["/healthz", "/metrics"] });
  });
  return httpServer;
}

function requestShutdown(signal: NodeJS.Signals): void {
  log.info("shutdown signal received, stopping after the current page", { signal });
  stopping = true;
  wakeFromSleep();
}

function sourceAccountOf(envelope: xdr.TransactionEnvelope): string {
  try {
    const tx =
      envelope.switch().name === "envelopeTypeTxFeeBump"
        ? envelope.feeBump().tx().innerTx().v1().tx()
        : envelope.v1().tx();
    return encodeMuxedAccountToAddress(tx.sourceAccount());
  } catch {
    return "";
  }
}

/** Rows one transaction contributes, grouped per table so a page can be written in bulk. */
export interface TransactionRows {
  invocations: Prisma.InvocationCreateManyInput[];
  contracts: Prisma.ContractCreateManyInput[];
  storageChanges: Prisma.StorageChangeCreateManyInput[];
  events: Prisma.ContractEventRecordCreateManyInput[];
}

/** Decode a transaction into the rows it would insert. Writes nothing. */
export function transactionRows(
  tx: rpc.Api.TransactionInfo,
  contractFilter: Set<string> | null = CONTRACT_IDS
): TransactionRows {
  const createdAt = new Date(tx.createdAt * 1000);
  const invocation = decodeInvocation(tx.envelopeXdr);
  const sourceAccount = sourceAccountOf(tx.envelopeXdr);

  const invocations: Prisma.InvocationCreateManyInput[] =
    invocation && isIndexedContract(invocation.contractId, contractFilter)
      ? [
          {
            txHash: tx.txHash,
            ledger: tx.ledger,
            createdAt,
            contractId: invocation.contractId,
            functionName: invocation.functionName,
            args: invocation.args as object,
            successful: tx.status === "SUCCESS",
            sourceAccount,
            returnValue:
              tx.status === "SUCCESS" ? extractInvocationReturnValue(tx.resultMetaXdr) : null,
          },
        ]
      : [];

  const contract =
    tx.status === "SUCCESS" && sourceAccount
      ? decodeContractCreation(tx.envelopeXdr, tx.resultMetaXdr, sourceAccount)
      : null;
  const contracts: Prisma.ContractCreateManyInput[] =
    contract && isIndexedContract(contract.contractId, contractFilter)
      ? [
          {
            contractId: contract.contractId,
            creator: contract.creator,
            deploymentLedger: tx.ledger,
            deploymentTxHash: tx.txHash,
            createdAt,
          },
        ]
      : [];

  const storageChanges: Prisma.StorageChangeCreateManyInput[] = extractStorageChanges(
    tx.resultMetaXdr
  )
    .filter((c) => isIndexedContract(c.contractId, contractFilter))
    .map((c) => ({
      contractId: c.contractId,
      durability: c.durability,
      keyDisplay: c.keyDisplay,
      valueDisplay: c.valueDisplay,
      changeType: c.changeType,
      ledger: tx.ledger,
      txHash: tx.txHash,
      createdAt,
    }));

  const extractedEvents = extractEvents(tx.resultMetaXdr, tx.txHash).filter((e) =>
    isIndexedContract(e.contractId, contractFilter)
  );
  if (contract && isIndexedContract(contract.contractId, contractFilter)) {
    extractedEvents.push(contractCreatedEvent(contract, tx.txHash));
  }
  const events: Prisma.ContractEventRecordCreateManyInput[] = extractedEvents.map((e) => ({
    eventId: e.eventId,
    eventIndex: e.eventIndex,
    contractId: e.contractId,
    type: e.type,
    topic: e.topic,
    value: e.value,
    deployer: e.deployer ?? null,
    salt: e.salt ?? null,
    wasmHash: e.wasmHash ?? null,
    txHash: tx.txHash,
    ledger: tx.ledger,
    createdAt,
  }));

  return { invocations, contracts, storageChanges, events };
}

/**
 * Insert a batch of transactions with one createMany per table instead of one
 * round-trip per row. `skipDuplicates` makes reprocessing a page after a
 * crash-before-cursor-advance safe; callers that need all-or-nothing semantics
 * pass a transaction client (see `commitPage`).
 */
export async function insertTransactions(
  transactions: rpc.Api.TransactionInfo[],
  db: Db = prisma,
  contractFilter: Set<string> | null = CONTRACT_IDS
): Promise<void> {
  const rows: TransactionRows = {
    invocations: [],
    contracts: [],
    storageChanges: [],
    events: [],
  };
  for (const tx of transactions) {
    const txRows = transactionRows(tx, contractFilter);
    rows.invocations.push(...txRows.invocations);
    rows.contracts.push(...txRows.contracts);
    rows.storageChanges.push(...txRows.storageChanges);
    rows.events.push(...txRows.events);
  }

  if (rows.invocations.length > 0) {
    const result = await db.invocation.createMany({ data: rows.invocations, skipDuplicates: true });
    metricRowsWritten.inc({ table: "invocation" }, result.count);
  }
  if (rows.contracts.length > 0) {
    const result = await db.contract.createMany({ data: rows.contracts, skipDuplicates: true });
    metricRowsWritten.inc({ table: "contract" }, result.count);
  }
  if (rows.storageChanges.length > 0) {
    const result = await db.storageChange.createMany({
      data: rows.storageChanges,
      skipDuplicates: true,
    });
    metricRowsWritten.inc({ table: "storageChange" }, result.count);
  }
  if (rows.events.length > 0) {
    const result = await db.contractEventRecord.createMany({
      data: rows.events,
      skipDuplicates: true,
    });
    metricRowsWritten.inc({ table: "contractEventRecord" }, result.count);
  }
}

/**
 * Process one transaction, recording it in the dead-letter queue instead of
 * failing the whole page when it cannot be decoded or persisted.
 */
export async function processTransactionSafely(
  tx: rpc.Api.TransactionInfo,
  db: Db = prisma
): Promise<void> {
  try {
    await processTransaction(tx, db);
  } catch (err) {
    await recordDeadLetterEvent(tx, "persist", errorMessage(err), db);
  }
}

/** Persist a failed transaction to the dead-letter queue and bump its metrics. */
export async function recordDeadLetterEvent(
  tx: rpc.Api.TransactionInfo,
  stage: DeadLetterStage,
  message: string,
  db: Db = prisma
): Promise<void> {
  await db.deadLetterEvent.upsert({
    where: { txHash_stage: { txHash: tx.txHash, stage } },
    update: { errorMessage: message, resolvedAt: null },
    create: {
      txHash: tx.txHash,
      ledger: tx.ledger,
      stage,
      errorMessage: message,
      envelopeXdr: tx.envelopeXdr.toXDR("base64"),
      resultMetaXdr: tx.resultMetaXdr.toXDR("base64"),
    },
  });
  metricDeadLetterEvents.inc({ stage });
  await refreshDeadLetterQueueSize(db);
}

/** Re-read the unresolved dead-letter count into the queue-size gauge. */
export async function refreshDeadLetterQueueSize(db: Db = prisma): Promise<void> {
  const size = await db.deadLetterEvent.count({ where: { resolvedAt: null } });
  metricDeadLetterQueueSize.set(size);
}

/** Index a single transaction. */
export async function processTransaction(
  tx: rpc.Api.TransactionInfo,
  db: Db = prisma,
  contractFilter: Set<string> | null = CONTRACT_IDS
): Promise<void> {
  await insertTransactions([tx], db, contractFilter);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** Where a page leaves the cursor, plus any ledger range the page skipped without indexing. */
export interface PageProgress {
  lastLedger: number;
  paginationCursor: string | null;
  gap?: { fromLedger: number; toLedger: number; reason: string };
  /** Every gap this page skipped, when more than one applies. */
  gaps?: { fromLedger: number; toLedger: number; reason: string }[];
}

/** The subset of `rpc.Server` the poll loop needs; injectable so tests can mock RPC responses. */
export type RpcClient = Pick<typeof server, "getTransactions" | "getLatestLedger" | "getHealth">;

/**
 * Warn when a page stops short of the ledgers it was asked to cover. A short page
 * that ends before `latestLedger` means the RPC node returned less history than it
 * reported (e.g. a retention-window cutoff), so the skipped ledgers are recorded as
 * a gap instead of being dropped silently.
 */
export function partialPageGap(
  transactions: rpc.Api.TransactionInfo[],
  lastLedger: number,
  latestLedger: number
): PageProgress["gap"] | undefined {
  if (transactions.length === 0 || lastLedger >= latestLedger) return undefined;
  const fromLedger = lastLedger + 1;
  log.warn("RPC returned a partial page; recording a gap", {
    transactionCount: transactions.length,
    lastLedger,
    latestLedger,
    gapFromLedger: fromLedger,
    gapToLedger: latestLedger,
  });
  return {
    fromLedger,
    toLedger: latestLedger,
    reason: `RPC returned a partial page ending at ledger ${lastLedger} (network at ${latestLedger})`,
  };
}

/** Fetch one transaction page from the persisted ledger and RPC pagination cursor. Writes nothing. */
export async function fetchPage(
  cursor: number,
  paginationCursor: string | null,
  latestLedger: number,
  client: RpcClient = server
): Promise<{ transactions: rpc.Api.TransactionInfo[]; progress: PageProgress }> {
  let res;
  try {
    res = paginationCursor
      ? await client.getTransactions({ pagination: { limit: PAGE_LIMIT, cursor: paginationCursor } })
      : await client.getTransactions({ startLedger: cursor + 1, pagination: { limit: PAGE_LIMIT } });
  } catch (err) {
    const message = errorMessage(err);

    // Public RPC is typically a load-balanced pool — a node can briefly lag
    // behind the one that answered our getLatestLedger() call, making it
    // report our very next ledger as "in the future". Transient: don't
    // advance the cursor, just retry on the next poll.
    const oldestMatch = message.match(/oldest ledger:\s*(\d+)/i);
    const latestMatch = message.match(/latest ledger:\s*(\d+)/i);
    if (oldestMatch && Number(oldestMatch[1]) > cursor + 1) {
      log.warn("ledger is before the RPC node's retention window, skipping ahead; history in the gap was missed", {
        requestedLedger: cursor + 1,
        oldestAvailable: Number(oldestMatch[1]),
        skippingTo: latestLedger,
      });
      return {
        transactions: [],
        progress: {
          lastLedger: latestLedger,
          paginationCursor: null,
          gap: {
            fromLedger: cursor + 1,
            toLedger: latestLedger,
            reason: `RPC retention: the node's oldest ledger is ${oldestMatch[1]}`,
          },
        },
      };
    }
    if (latestMatch && Number(latestMatch[1]) < cursor + 1) {
      return { transactions: [], progress: { lastLedger: cursor, paginationCursor } };
    }
    throw err;
  }

  if (res.transactions.length === 0) {
    return { transactions: [], progress: { lastLedger: latestLedger, paginationCursor: null } };
  }
  if (res.transactions.length === PAGE_LIMIT && (!res.cursor || res.cursor === paginationCursor)) {
    throw new Error("RPC returned a full page without advancing its transaction cursor");
  }
  const lastLedger = Math.max(cursor, ...res.transactions.map((t) => t.ledger));
  const gap = partialPageGap(res.transactions, lastLedger, latestLedger);
  return {
    transactions: res.transactions,
    progress: {
      lastLedger,
      paginationCursor: res.transactions.length === PAGE_LIMIT ? res.cursor : null,
      ...(gap ? { gap, gaps: [gap] } : {}),
    },
  };
}

/**
 * Apply one page, its gap record, and its cursor in a single transaction, so the page
 * lands fully or not at all. A failure leaves no new rows and the old cursor in place.
 */
export async function commitPage(
  transactions: rpc.Api.TransactionInfo[],
  progress: PageProgress,
  client: Pick<typeof prisma, "$transaction"> = prisma
): Promise<void> {
  await client.$transaction(
    async (db) => {
      await insertTransactions(transactions, db);
      if (progress.gap) {
        // A page can carry both a retention gap and a partial-page gap; keep both.
        await db.indexerGap.createMany({ data: progress.gaps ?? [progress.gap] });
      }
      await setCursor(progress.lastLedger, progress.paginationCursor, db);
    },
    { timeout: 30_000 }
  );
}

export async function main(): Promise<void> {
  const network = await server.getHealth();
  const existing = await findCursor();
  if (existing && process.env.INDEXER_START_LEDGER) {
    log.warn("INDEXER_START_LEDGER is ignored because the cursor already exists", {
      cursorLedger: existing.lastLedger,
      requested: process.env.INDEXER_START_LEDGER,
    });
  }
  const initialCursor =
    existing ?? (await seedCursor(seedLastLedger(process.env.INDEXER_START_LEDGER, network)));
  let cursor = initialCursor.lastLedger;
  let paginationCursor = initialCursor.paginationCursor;
  health.cursor = cursor;
  health.latestLedger = network.latestLedger;
  log.info("starting", { cursor, latestLedger: network.latestLedger });
  if (CONTRACT_IDS === null) {
    log.info("indexing all contracts");
  } else {
    log.info("indexing filtered contracts", { contractCount: CONTRACT_IDS.size });
  }

  const healthServer = startHealthServer();
  process.once("SIGTERM", requestShutdown);
  process.once("SIGINT", requestShutdown);

  let consecutiveFailures = 0;
  while (!stopping) {
    let delayMs = 0;
    try {
      const latestNow = await server.getLatestLedger();
      health.latestLedger = latestNow.sequence;
      if (stopping) break;

      let caughtUp = true;
      if (cursor < latestNow.sequence || paginationCursor) {
        const page = await fetchPage(cursor, paginationCursor, latestNow.sequence);
        const { progress } = page;
        if (
          page.transactions.length > 0 ||
          progress.lastLedger !== cursor ||
          progress.paginationCursor !== paginationCursor
        ) {
          await commitPage(page.transactions, progress);
          cursor = progress.lastLedger;
          paginationCursor = progress.paginationCursor;
          health.cursor = cursor;
          log.info("processed through ledger", { cursor });
        }
        caughtUp = cursor >= latestNow.sequence && !paginationCursor;
        if (page.transactions.length > 0) {
          metricLedgersProcessed.inc();
        }
      }
      consecutiveFailures = 0;
      health.lastPollFailed = false;
      metricLag.set(Math.max(0, health.latestLedger - health.cursor));
      delayMs = caughtUp ? POLL_INTERVAL_MS : 0;
    } catch (err) {
      consecutiveFailures++;
      health.lastPollFailed = true;
      metricPollErrors.inc();
      delayMs = backoffDelay(consecutiveFailures);
      log.error("poll failed, retrying", { consecutiveFailures, retryInMs: delayMs, err });
    }
    if (!stopping) await sleep(delayMs);
  }

  log.info("shutting down", { cursor });
  await setCursor(cursor, paginationCursor);
  healthServer.close();
  await prisma.$disconnect();
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (err) => {
    log.error("fatal error", { err });
    await prisma.$disconnect();
    process.exit(1);
  });
}
