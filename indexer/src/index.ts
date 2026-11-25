import { rpc, encodeMuxedAccountToAddress, type xdr } from "@stellar/stellar-sdk";
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { Registry, Counter, Gauge, collectDefaultMetrics } from "prom-client";
import { prisma, findCursor, seedCursor, setCursor, type Db } from "./db.js";
import {
  decodeContractCreation,
  decodeInvocation,
  extractEvents,
  extractInvocationReturnValue,
  extractInvocationStorageChanges,
  extractStorageChanges,
} from "./decode.js";

// ---------------------------------------------------------------------------
// Environment variable validation (#20)
// ---------------------------------------------------------------------------
function requireEnv(name: string, fallback?: string): string {
  const val = process.env[name] ?? fallback;
  if (val === undefined) {
    console.error(`[indexer] fatal: environment variable ${name} is required but not set`);
    process.exit(1);
  }
  return val;
}

function requirePositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    console.error(
      `[indexer] fatal: ${name} must be a positive integer, got "${raw}"`
    );
    process.exit(1);
  }
  return n;
}

const RPC_URL = requireEnv("SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org");
const RPC_FAILOVER_THRESHOLD = requirePositiveInt("SOROBAN_RPC_FAILOVER_THRESHOLD", 3);
const POLL_INTERVAL_MS = requirePositiveInt("POLL_INTERVAL_MS", 5000);
const HEALTH_PORT = requirePositiveInt("HEALTH_PORT", 8080);
const MAX_LEDGER_LAG = requirePositiveInt("HEALTH_MAX_LEDGER_LAG", 60);
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
export const PAGE_LIMIT = 50;

/**
 * Data retention (#72). INDEXER_RETENTION_DAYS is the number of days of events and
 * invocations to keep; unset (or blank) means unlimited, i.e. nothing is pruned.
 */
export const RETENTION_DAYS = parseRetentionDays(process.env.INDEXER_RETENTION_DAYS);
export const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export function parseRetentionDays(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    console.error(
      `[indexer] fatal: INDEXER_RETENTION_DAYS must be a positive integer, got "${raw}"`
    );
    process.exit(1);
  }
  return n;
}

/** Rows older than this instant are pruned; null when retention is unlimited. */
export function retentionCutoff(days: number | null, now: number = Date.now()): Date | null {
  if (days === null) return null;
  return new Date(now - days * 24 * 60 * 60 * 1_000);
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
  name: "indexer_lag_ledgers",
  help: "Current lag in ledgers between the network latest ledger and the last indexed ledger",
  registers: [metricsRegistry],
});

export const metricPollErrors = new Counter({
  name: "indexer_poll_errors_total",
  help: "Total number of poll errors encountered",
  registers: [metricsRegistry],
});

export const metricRowsPruned = new Counter({
  name: "indexer_rows_pruned_total",
  help: "Total rows deleted by the retention pruning task, partitioned by table",
  labelNames: ["table"] as const,
  registers: [metricsRegistry],
});

/**
 * RPC endpoint failover (#71). SOROBAN_RPC_URLS is a comma-separated list of
 * endpoints; the first entry is the primary. SOROBAN_RPC_URL is still honoured
 * and used as the primary when SOROBAN_RPC_URLS is unset.
 */
export function parseRpcUrls(raw: string | undefined, primary: string): string[] {
  const urls = (raw ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url !== "");
  const all = urls.length > 0 ? urls : [primary];
  return [...new Set(all)];
}

export const RPC_URLS = parseRpcUrls(process.env.SOROBAN_RPC_URLS, RPC_URL);

/**
 * Rotates through RPC endpoints after `threshold` consecutive failures and
 * returns to the primary as soon as it answers again.
 */
export class RpcFailover {
  private index = 0;
  private failures = 0;

  constructor(
    readonly urls: string[],
    private readonly threshold: number = RPC_FAILOVER_THRESHOLD
  ) {
    if (urls.length === 0) throw new Error("at least one RPC URL is required");
  }

  get activeUrl(): string {
    return this.urls[this.index];
  }

  get activeServer(): rpc.Server {
    return this.servers[this.index];
  }

  private readonly servers = this.urls.map(
    (url) => new rpc.Server(url, { timeout: 10_000 })
  );

  /** Record a successful call: reset the failure count and prefer the primary again. */
  recordSuccess(): void {
    this.failures = 0;
    if (this.index !== 0) {
      this.index = 0;
      console.log(`[indexer] RPC endpoint recovered, switching back to primary ${this.activeUrl}`);
    }
  }

  /** Record a failed call; returns true when the active endpoint was rotated. */
  recordFailure(): boolean {
    this.failures++;
    if (this.failures < this.threshold || this.urls.length === 1) return false;
    this.failures = 0;
    this.index = (this.index + 1) % this.urls.length;
    console.warn(
      `[indexer] RPC endpoint failed ${this.threshold} times in a row, switching to ${this.activeUrl}`
    );
    return true;
  }
}

export const failover = new RpcFailover(RPC_URLS);
console.log(`[indexer] active RPC endpoint: ${failover.activeUrl}`);

/** The RPC server currently in use; follows failover rotations. */
export const server = {
  getHealth: () => failover.activeServer.getHealth(),
  getLatestLedger: () => failover.activeServer.getLatestLedger(),
  getTransactions: (args: Parameters<rpc.Server["getTransactions"]>[0]) =>
    failover.activeServer.getTransactions(args),
};

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

const LAG_LOG_INTERVAL_MS = 60_000;

/** Lag in ledgers between the network latest ledger and the last indexed ledger. */
export function ledgerLag(latestNetworkLedger: number, lastIndexedLedger: number): number {
  return Math.max(0, latestNetworkLedger - lastIndexedLedger);
}

/** Records the lag gauge and logs it at most once per LAG_LOG_INTERVAL_MS. */
export function recordLag(
  latestNetworkLedger: number,
  lastIndexedLedger: number,
  now: number = Date.now()
): number {
  const lag = ledgerLag(latestNetworkLedger, lastIndexedLedger);
  metricLag.set(lag);
  if (now - lastLagLogAt >= LAG_LOG_INTERVAL_MS) {
    lastLagLogAt = now;
    console.log(
      `[indexer] lag: ${lag} ledgers (network ${latestNetworkLedger}, indexed ${lastIndexedLedger})`
    );
  }
  return lag;
}

let lastLagLogAt = 0;

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
    console.log(
      `[indexer] health endpoint listening on port ${HEALTH_PORT} (GET /healthz, GET /metrics)`
    );
  });
  return httpServer;
}

function requestShutdown(signal: NodeJS.Signals): void {
  console.log(`[indexer] ${signal} received, stopping after the current page`);
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

export async function processTransaction(tx: rpc.Api.TransactionInfo, db: Db = prisma): Promise<void> {
  const createdAt = new Date(tx.createdAt * 1000);
  const invocation = decodeInvocation(tx.envelopeXdr);
  const sourceAccount = sourceAccountOf(tx.envelopeXdr);

  if (invocation) {
    // skipDuplicates makes reprocessing a page after a crash-before-cursor-advance safe.
    const invocationResult = await db.invocation.createMany({
      data: [
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
      ],
      skipDuplicates: true,
    });
    metricRowsWritten.inc({ table: "invocation" }, invocationResult.count);

    if (tx.status === "SUCCESS") {
      const invocationChanges = extractInvocationStorageChanges(tx.resultMetaXdr);
      if (invocationChanges.length > 0) {
        const record = await db.invocation.findUnique({
          where: { txHash: tx.txHash },
          select: { id: true },
        });
        if (record) {
          const changeResult = await db.invocationStorageChange.createMany({
            skipDuplicates: true,
            data: invocationChanges.map((c) => ({
              invocationId: record.id,
              contractId: c.contractId,
              durability: c.durability,
              key: c.key,
              valueBefore: c.valueBefore,
              valueAfter: c.valueAfter,
              ledger: tx.ledger,
              txHash: tx.txHash,
              createdAt,
            })),
          });
          metricRowsWritten.inc({ table: "invocationStorageChange" }, changeResult.count);
        }
      }
    }
  }

  if (tx.status === "SUCCESS" && sourceAccount) {
    const contract = decodeContractCreation(tx.envelopeXdr, tx.resultMetaXdr, sourceAccount);
    if (contract) {
      const contractResult = await db.contract.createMany({
        data: [
          {
            contractId: contract.contractId,
            creator: contract.creator,
            deploymentLedger: tx.ledger,
            deploymentTxHash: tx.txHash,
            createdAt,
          },
        ],
        skipDuplicates: true,
      });
      metricRowsWritten.inc({ table: "contract" }, contractResult.count);
    }
  }

  const changes = extractStorageChanges(tx.resultMetaXdr);
  if (changes.length > 0) {
    const storageResult = await db.storageChange.createMany({
      skipDuplicates: true,
      data: changes.map((c) => ({
        contractId: c.contractId,
        durability: c.durability,
        keyDisplay: c.keyDisplay,
        valueDisplay: c.valueDisplay,
        changeType: c.changeType,
        ledger: tx.ledger,
        txHash: tx.txHash,
        createdAt,
      })),
    });
    metricRowsWritten.inc({ table: "storageChange" }, storageResult.count);
  }

  const events = extractEvents(tx.resultMetaXdr, tx.txHash);
  if (events.length > 0) {
    const eventsResult = await db.contractEventRecord.createMany({
      skipDuplicates: true,
      data: events.map((e) => ({
        eventId: e.eventId,
        contractId: e.contractId,
        type: e.type,
        topic: e.topic,
        value: e.value,
        txHash: tx.txHash,
        ledger: tx.ledger,
        createdAt,
      })),
    });
    metricRowsWritten.inc({ table: "contractEventRecord" }, eventsResult.count);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/**
 * Delete events and invocations older than the retention window (#72). Contracts are
 * permanent and never pruned. Returns the number of rows deleted per table.
 */
export async function pruneOldRecords(
  days: number | null,
  db: Db = prisma,
  now: number = Date.now()
): Promise<{ events: number; invocations: number }> {
  const cutoff = retentionCutoff(days, now);
  if (cutoff === null) return { events: 0, invocations: 0 };

  const events = await db.contractEventRecord.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  const invocations = await db.invocation.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { events: events.count, invocations: invocations.count };
}

/** Run pruning once and log the pruned row count. Never throws. */
export async function runPrune(
  days: number | null = RETENTION_DAYS,
  db: Db = prisma
): Promise<void> {
  if (days === null) return;
  try {
    const { events, invocations } = await pruneOldRecords(days, db);
    metricRowsPruned.inc({ table: "contractEventRecord" }, events);
    metricRowsPruned.inc({ table: "invocation" }, invocations);
    console.log(
      `[indexer] retention: pruned ${events} events and ${invocations} invocations older than ${days} days`
    );
  } catch (err) {
    console.error("[indexer] retention: pruning failed:", err);
  }
}

/** Prune now, then once per PRUNE_INTERVAL_MS until the returned timer is cleared. */
export function startPruneSchedule(
  days: number | null = RETENTION_DAYS,
  intervalMs: number = PRUNE_INTERVAL_MS
): NodeJS.Timeout | null {
  if (days === null) {
    console.log("[indexer] retention: INDEXER_RETENTION_DAYS unset, pruning disabled");
    return null;
  }
  console.log(`[indexer] retention: pruning events and invocations older than ${days} days daily`);
  void runPrune(days);
  const timer = setInterval(() => void runPrune(days), intervalMs);
  timer.unref();
  return timer;
}

/** Where a page leaves the cursor, plus any ledger range the page skipped without indexing. */
export interface PageProgress {
  lastLedger: number;
  paginationCursor: string | null;
  gap?: { fromLedger: number; toLedger: number; reason: string };
}

/** Fetch one transaction page from the persisted ledger and RPC pagination cursor. Writes nothing. */
async function fetchPage(
  cursor: number,
  paginationCursor: string | null,
  latestLedger: number
): Promise<{ transactions: rpc.Api.TransactionInfo[]; progress: PageProgress }> {
  let res;
  try {
    res = paginationCursor
      ? await server.getTransactions({ pagination: { limit: PAGE_LIMIT, cursor: paginationCursor } })
      : await server.getTransactions({ startLedger: cursor + 1, pagination: { limit: PAGE_LIMIT } });
  } catch (err) {
    const message = errorMessage(err);

    // Public RPC is typically a load-balanced pool — a node can briefly lag
    // behind the one that answered our getLatestLedger() call, making it
    // report our very next ledger as "in the future". Transient: don't
    // advance the cursor, just retry on the next poll.
    const oldestMatch = message.match(/oldest ledger:\s*(\d+)/i);
    const latestMatch = message.match(/latest ledger:\s*(\d+)/i);
    if (oldestMatch && Number(oldestMatch[1]) > cursor + 1) {
      console.warn(
        `[indexer] ledger ${cursor + 1} is before the RPC node's retention window (oldest: ${oldestMatch[1]}) — ` +
          `skipping ahead to ${latestLedger}. Some history in the gap was missed.`
      );
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
  return {
    transactions: res.transactions,
    progress: {
      lastLedger: Math.max(cursor, ...res.transactions.map((t) => t.ledger)),
      paginationCursor: res.transactions.length === PAGE_LIMIT ? res.cursor : null,
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
      for (const tx of transactions) {
        await processTransaction(tx, db);
      }
      if (progress.gap) {
        await db.indexerGap.create({ data: progress.gap });
      }
      await setCursor(progress.lastLedger, progress.paginationCursor, db);
    },
    { timeout: 30_000 }
  );
}

async function main(): Promise<void> {
  const network = await server.getHealth();
  failover.recordSuccess();
  const existing = await findCursor();
  if (existing && process.env.INDEXER_START_LEDGER) {
    console.warn(
      `[indexer] INDEXER_START_LEDGER is ignored: the cursor already exists at ledger ${existing.lastLedger}`
    );
  }
  const initialCursor =
    existing ?? (await seedCursor(seedLastLedger(process.env.INDEXER_START_LEDGER, network)));
  let cursor = initialCursor.lastLedger;
  let paginationCursor = initialCursor.paginationCursor;
  health.cursor = cursor;
  health.latestLedger = network.latestLedger;
  console.log(`[indexer] starting at ledger ${cursor} (network is at ${network.latestLedger})`);
  console.log(`[indexer] active RPC endpoint: ${failover.activeUrl}`);

  const healthServer = startHealthServer();
  const pruneTimer = startPruneSchedule();
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
          console.log(`[indexer] processed through ledger ${cursor}`);
        }
        caughtUp = cursor >= latestNow.sequence && !paginationCursor;
        if (page.transactions.length > 0) {
          metricLedgersProcessed.inc();
        }
      }
      consecutiveFailures = 0;
      failover.recordSuccess();
      health.lastPollFailed = false;
      recordLag(health.latestLedger, health.cursor);
      delayMs = caughtUp ? POLL_INTERVAL_MS : 0;
    } catch (err) {
      consecutiveFailures++;
      failover.recordFailure();
      health.lastPollFailed = true;
      metricPollErrors.inc();
      delayMs = backoffDelay(consecutiveFailures);
      console.error(
        `[indexer] poll error (failure ${consecutiveFailures}), retrying in ${delayMs}ms:`,
        err
      );
    }
    if (!stopping) await sleep(delayMs);
  }

  console.log("[indexer] shutting down");
  if (pruneTimer) clearInterval(pruneTimer);
  await setCursor(cursor, paginationCursor);
  healthServer.close();
  await prisma.$disconnect();
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (err) => {
    console.error("[indexer] fatal error:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
}
