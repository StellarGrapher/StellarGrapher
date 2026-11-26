import { rpc, encodeMuxedAccountToAddress, type xdr } from "@stellar/stellar-sdk";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { Registry, Counter, Gauge, collectDefaultMetrics } from "prom-client";
import type { Prisma } from "@prisma/client";
import { prisma, findCursor, seedCursor, setCursor, type Db } from "./db.js";
import { log } from "./logger.js";
import {
  contractCreatedEvent,
  contractExpiresAtLedger,
  contractInstanceLedgerKey,
  decodeContractCreation,
  decodeInvocation,
  decodeTokenEvent,
  extractEvents,
  extractInvocationReturnValue,
  extractInvocationStorageChanges,
  extractStorageChanges,
  type DecodedTokenEvent,
} from "./decode.js";
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
const RPC_FAILOVER_THRESHOLD = requirePositiveInt("SOROBAN_RPC_FAILOVER_THRESHOLD", 3);
const POLL_INTERVAL_MS = requirePositiveInt("INDEXER_POLL_INTERVAL_MS", 6000);
const HEALTH_PORT = requirePositiveInt("HEALTH_PORT", 8080);
const METRICS_LISTEN_ADDR = process.env.METRICS_LISTEN_ADDR?.trim() || "127.0.0.1:9090";
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
    log.error("INDEXER_RETENTION_DAYS must be a positive integer", {
      envVar: "INDEXER_RETENTION_DAYS",
      value: raw,
      fatal: true,
    });
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

export const metricEventsIndexed = new Counter({
  name: "indexer_events_indexed_total",
  help: "Total number of contract events indexed",
  registers: [metricsRegistry],
});

export const metricLag = new Gauge({
  name: "indexer_lag_ledgers",
  help: "Current lag in ledgers between the network latest ledger and the last indexed ledger",
  registers: [metricsRegistry],
});

export const metricErrors = new Counter({
  name: "indexer_errors_total",
  help: "Total number of indexer errors encountered",
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
      log.info("RPC endpoint recovered; switched back to primary", { rpcUrl: this.activeUrl });
    }
  }

  /** Record a failed call; returns true when the active endpoint was rotated. */
  recordFailure(): boolean {
    this.failures++;
    if (this.failures < this.threshold || this.urls.length === 1) return false;
    this.failures = 0;
    this.index = (this.index + 1) % this.urls.length;
    log.warn("RPC endpoint failed repeatedly; switched to fallback", {
      failureThreshold: this.threshold,
      rpcUrl: this.activeUrl,
    });
    return true;
  }
}

export const failover = new RpcFailover(RPC_URLS);
log.info("active RPC endpoint", { rpcUrl: failover.activeUrl });

/** The RPC server currently in use; follows failover rotations. */
export const server = {
  getHealth: () => failover.activeServer.getHealth(),
  getLatestLedger: () => failover.activeServer.getLatestLedger(),
  getTransactions: (args: Parameters<rpc.Server["getTransactions"]>[0]) =>
    failover.activeServer.getTransactions(args),
  getLedgerEntries: (key: xdr.LedgerKey) => failover.activeServer.getLedgerEntries(key),
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

// ---------------------------------------------------------------------------
// Admin re-indexing (#76)
// ---------------------------------------------------------------------------
export interface ReindexRequest {
  fromLedger: number;
  toLedger: number;
  contractId?: string;
}

/** Parse and validate a POST /admin/reindex body. Throws with a client-facing message. */
export function parseReindexRequest(body: unknown): ReindexRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("body must be a JSON object");
  }
  const { fromLedger, toLedger, contractId } = body as Record<string, unknown>;
  if (!Number.isSafeInteger(fromLedger) || (fromLedger as number) < 1) {
    throw new Error("fromLedger must be a positive integer");
  }
  if (!Number.isSafeInteger(toLedger) || (toLedger as number) < (fromLedger as number)) {
    throw new Error("toLedger must be an integer greater than or equal to fromLedger");
  }
  if (contractId !== undefined && (typeof contractId !== "string" || contractId.trim() === "")) {
    throw new Error("contractId must be a non-empty string when provided");
  }
  if (typeof contractId === "string" && !/^C[A-Z2-7]{55}$/.test(contractId.trim())) {
    throw new Error("contractId must be a valid Stellar contract ID");
  }
  return {
    fromLedger: fromLedger as number,
    toLedger: toLedger as number,
    ...(contractId === undefined ? {} : { contractId: (contractId as string).trim() }),
  };
}

/** Constant-time-ish comparison of the bearer token against ADMIN_TOKEN. */
export function isAuthorizedAdmin(header: string | undefined, token: string | undefined): boolean {
  if (!token) return false;
  const expected = `Bearer ${token}`;
  if (header === undefined || header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** Only one re-index runs at a time; a second request is rejected with 409. */
let reindexRunning = false;

/**
 * Re-index a ledger range (optionally narrowed to one contract) without touching
 * the live cursor. Rows are re-inserted with `skipDuplicates`, so replaying a
 * range is idempotent and never blocks or rewinds live indexing.
 */
export async function reindexRange(
  request: ReindexRequest,
  db: Db = prisma
): Promise<{ ledgers: number; transactions: number }> {
  const { fromLedger, toLedger, contractId } = request;
  let paginationCursor: string | null = null;
  let startLedger = fromLedger;
  let ledgers = 0;
  let transactions = 0;

  while (true) {
    const response = paginationCursor
      ? await server.getTransactions({ pagination: { limit: PAGE_LIMIT, cursor: paginationCursor } })
      : await server.getTransactions({ startLedger, pagination: { limit: PAGE_LIMIT } });

    let reachedEnd = false;
    let lastLedger = startLedger - 1;
    for (const tx of response.transactions) {
      if (tx.ledger > toLedger) {
        reachedEnd = true;
        break;
      }
      if (tx.ledger < fromLedger) continue;
      if (tx.ledger !== lastLedger) {
        ledgers += 1;
        lastLedger = tx.ledger;
        log.info("re-indexing ledger", {
          component: "reindex",
          ledger: tx.ledger,
          fromLedger,
          toLedger,
        });
      }
      if (contractId !== undefined && !transactionTouchesContract(tx, contractId)) continue;
      await processTransaction(tx, db);
      transactions += 1;
    }

    if (reachedEnd) break;
    if (response.transactions.length === PAGE_LIMIT) {
      if (!response.cursor || response.cursor === paginationCursor) {
        throw new Error("RPC returned a full page without advancing its transaction cursor");
      }
      paginationCursor = response.cursor;
      continue;
    }
    if (response.latestLedger < toLedger) {
      throw new Error(
        `RPC history currently reaches ledger ${response.latestLedger}, before requested ledger ${toLedger}`
      );
    }
    break;
  }

  log.info("completed ledger range", {
    component: "reindex",
    fromLedger,
    toLedger,
    contractId,
    transactions,
  });
  return { ledgers, transactions };
}

/** True when the transaction invokes, creates, or emits events for `contractId`. */
function transactionTouchesContract(tx: rpc.Api.TransactionInfo, contractId: string): boolean {
  const invocation = decodeInvocation(tx.envelopeXdr);
  if (invocation?.contractId === contractId) return true;
  const sourceAccount = sourceAccountOf(tx.envelopeXdr);
  if (tx.status === "SUCCESS" && sourceAccount) {
    const creation = decodeContractCreation(tx.envelopeXdr, tx.resultMetaXdr, sourceAccount);
    if (creation?.contractId === contractId) return true;
  }
  if (extractStorageChanges(tx.resultMetaXdr).some((c) => c.contractId === contractId)) return true;
  return extractEvents(tx.resultMetaXdr, tx.txHash).some((e) => e.contractId === contractId);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") return {};
  return JSON.parse(raw);
}

async function handleReindexRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const send = (status: number, payload: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };

  if (!isAuthorizedAdmin(req.headers.authorization, process.env.ADMIN_TOKEN)) {
    send(401, { error: "unauthorized" });
    return;
  }
  if (reindexRunning) {
    send(409, { error: "a re-index is already running" });
    return;
  }

  let request: ReindexRequest;
  try {
    request = parseReindexRequest(await readJsonBody(req));
  } catch (err) {
    send(400, { error: errorMessage(err) });
    return;
  }

  reindexRunning = true;
  try {
    const result = await reindexRange(request);
    send(200, { ok: true, ...request, ...result });
  } catch (err) {
    log.error("admin re-index failed", { component: "reindex", err });
    send(500, { error: errorMessage(err) });
  } finally {
    reindexRunning = false;
  }
}

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
    log.info("ledger lag", { lag, latestNetworkLedger, lastIndexedLedger });
  }
  return lag;
}

let lastLagLogAt = 0;

function startHealthServer(): Server {
  const httpServer = createServer(async (req, res) => {
    const path = req.url?.split("?")[0];
    if (req.method === "POST" && path === "/admin/reindex") {
      await handleReindexRequest(req, res);
      return;
    }
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
    if (path === "/metrics") {
      const metrics = await metricsRegistry.metrics();
      res.writeHead(200, { "content-type": metricsRegistry.contentType });
      res.end(metrics);
      return;
    }
    if (path === "/metrics") {
      const metrics = await metricsRegistry.metrics();
      res.writeHead(200, { "content-type": metricsRegistry.contentType });
      res.end(metrics);
      return;
    }
    if (path === "/metrics") {
      const metrics = await metricsRegistry.metrics();
      res.writeHead(200, { "content-type": metricsRegistry.contentType });
      res.end(metrics);
      return;
    }
    if (path === "/metrics") {
      const metrics = await metricsRegistry.metrics();
      res.writeHead(200, { "content-type": metricsRegistry.contentType });
      res.end(metrics);
      return;
    }
    if (path === "/metrics") {
      const metrics = await metricsRegistry.metrics();
      res.writeHead(200, { "content-type": metricsRegistry.contentType });
      res.end(metrics);
      return;
    }
    if (path === "/metrics") {
      const metrics = await metricsRegistry.metrics();
      res.writeHead(200, { "content-type": metricsRegistry.contentType });
      res.end(metrics);
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
    log.info("health endpoint listening", {
      port: HEALTH_PORT,
      routes: ["/healthz", "/metrics", "/admin/reindex"],
    });
  });
  return httpServer;
}

function startMetricsServer(): Server {
  const httpServer = createServer(async (req, res) => {
    const path = req.url?.split("?")[0];
    if (req.method !== "GET") {
      res.writeHead(405).end();
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
  const [host, port] = splitListenAddr(METRICS_LISTEN_ADDR);
  httpServer.listen(port, host, () => {
    console.log(`[indexer] metrics endpoint listening on ${host}:${port} (GET /metrics)`);
  });
  return httpServer;
}

/** Split a `host:port` listen address, defaulting the host to localhost. */
export function splitListenAddr(addr: string): [string, number] {
  const idx = addr.lastIndexOf(":");
  const host = idx === -1 ? "127.0.0.1" : addr.slice(0, idx) || "127.0.0.1";
  const port = Number(idx === -1 ? addr : addr.slice(idx + 1));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`[indexer] fatal: METRICS_LISTEN_ADDR must be host:port, got "${addr}"`);
    process.exit(1);
  }
  return [host, port];
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

/**
 * Expiration ledger of a contract's instance entry, read from getLedgerEntries'
 * TTL field. A failed lookup leaves the optional column null.
 */
async function fetchExpiresAtLedger(
  contractId: string,
  rpcServer: Pick<typeof server, "getLedgerEntries">
): Promise<number | null> {
  try {
    const response = await rpcServer.getLedgerEntries(contractInstanceLedgerKey(contractId));
    return contractExpiresAtLedger(response, contractId);
  } catch (err) {
    log.warn("could not read contract TTL", { component: "reindex", contractId, err });
    return null;
  }
}

/** Rows one transaction contributes, grouped per table so a page can be written in bulk. */
export interface TransactionRows {
  invocations: Prisma.InvocationCreateManyInput[];
  invocationStorageChanges: PendingInvocationStorageChange[];
  contracts: Prisma.ContractCreateManyInput[];
  storageChanges: Prisma.StorageChangeCreateManyInput[];
  events: Prisma.ContractEventRecordCreateManyInput[];
  tokenEvents: Prisma.TokenEventCreateManyInput[];
}

type PendingInvocationStorageChange = Pick<
  Prisma.InvocationStorageChangeCreateManyInput,
  "contractId" | "durability" | "key" | "valueBefore" | "valueAfter" | "ledger" | "txHash" | "createdAt"
> & { invocationTxHash: string };

/** Decode a transaction into the rows it would insert. Writes nothing. */
export function transactionRows(
  tx: rpc.Api.TransactionInfo,
  contractFilter: Set<string> | null = CONTRACT_IDS
): TransactionRows {
  const createdAt = new Date(tx.createdAt * 1000);
  const invocation = decodeInvocation(tx.envelopeXdr);
  const sourceAccount = sourceAccountOf(tx.envelopeXdr);

  const shouldIndexInvocation =
    invocation !== null && isIndexedContract(invocation.contractId, contractFilter);
  const invocations: Prisma.InvocationCreateManyInput[] =
    shouldIndexInvocation && invocation
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
  const invocationStorageChanges: PendingInvocationStorageChange[] =
    shouldIndexInvocation && tx.status === "SUCCESS"
      ? extractInvocationStorageChanges(tx.resultMetaXdr)
          .filter((change) => isIndexedContract(change.contractId, contractFilter))
          .map((change) => ({
            ...change,
            txHash: tx.txHash,
            ledger: tx.ledger,
            createdAt,
            invocationTxHash: tx.txHash,
          }))
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
            deployerAccountId: contract.deployerAccountId ?? sourceAccount,
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
      changeIndex: c.changeIndex,
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
  const tokenEvents: Prisma.TokenEventCreateManyInput[] = extractedEvents
    .map((event) => decodeTokenEvent(event, tx.txHash, tx.ledger))
    .filter((event): event is DecodedTokenEvent => event !== null)
    .map((event) => ({
      eventId: event.eventId,
      tokenContractId: event.tokenContractId,
      eventType: event.eventType,
      from: event.from,
      to: event.to,
      spender: event.spender,
      amount: event.amount,
      txHash: event.txHash,
      ledger: event.ledger,
      createdAt,
    }));

  return { invocations, invocationStorageChanges, contracts, storageChanges, events, tokenEvents };
}

async function collectTransactionRows(
  transactions: rpc.Api.TransactionInfo[],
  contractFilter: Set<string> | null,
  rpcServer: Pick<typeof server, "getLedgerEntries">
): Promise<TransactionRows> {
  const rows: TransactionRows = {
    invocations: [],
    invocationStorageChanges: [],
    contracts: [],
    storageChanges: [],
    events: [],
    tokenEvents: [],
  };
  for (const tx of transactions) {
    const txRows = transactionRows(tx, contractFilter);
    rows.invocations.push(...txRows.invocations);
    rows.invocationStorageChanges.push(...txRows.invocationStorageChanges);
    rows.contracts.push(...txRows.contracts);
    rows.storageChanges.push(...txRows.storageChanges);
    rows.events.push(...txRows.events);
    rows.tokenEvents.push(...txRows.tokenEvents);
  }

  rows.contracts = await Promise.all(
    rows.contracts.map(async (contract) => ({
      ...contract,
      expiresAtLedger: await fetchExpiresAtLedger(contract.contractId, rpcServer),
    }))
  );
  return rows;
}

async function insertTransactionRows(rows: TransactionRows, db: Db): Promise<void> {
  if (rows.invocations.length > 0) {
    const result = await db.invocation.createMany({ data: rows.invocations, skipDuplicates: true });
    metricRowsWritten.inc({ table: "invocation" }, result.count);
  }
  if (rows.invocationStorageChanges.length > 0) {
    const txHashes = [...new Set(rows.invocationStorageChanges.map((change) => change.invocationTxHash))];
    const records = await db.invocation.findMany({
      where: { txHash: { in: txHashes } },
      select: { id: true, txHash: true },
    });
    const invocationIds = new Map(records.map((record) => [record.txHash, record.id]));
    const changes = rows.invocationStorageChanges.flatMap(({ invocationTxHash, ...change }) => {
      const invocationId = invocationIds.get(invocationTxHash);
      return invocationId ? [{ ...change, invocationId }] : [];
    });
    if (changes.length > 0) {
      const result = await db.invocationStorageChange.createMany({
        data: changes,
        skipDuplicates: true,
      });
      metricRowsWritten.inc({ table: "invocationStorageChange" }, result.count);
    }
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
    metricEventsIndexed.inc(result.count);
  }
  if (rows.tokenEvents.length > 0) {
    const result = await db.tokenEvent.createMany({
      data: rows.tokenEvents,
      skipDuplicates: true,
    });
    metricRowsWritten.inc({ table: "tokenEvent" }, result.count);
  }
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
  contractFilter: Set<string> | null = CONTRACT_IDS,
  rpcServer: Pick<typeof server, "getLedgerEntries"> = server
): Promise<void> {
  const rows = await collectTransactionRows(transactions, contractFilter, rpcServer);
  await insertTransactionRows(rows, db);
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
  contractFilter: Set<string> | null = CONTRACT_IDS,
  rpcServer: Pick<typeof server, "getLedgerEntries"> = server
): Promise<void> {
  await insertTransactions([tx], db, contractFilter, rpcServer);
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
): Promise<{
  events: number;
  tokenEvents: number;
  invocations: number;
  invocationStorageChanges: number;
}> {
  const cutoff = retentionCutoff(days, now);
  if (cutoff === null) {
    return { events: 0, tokenEvents: 0, invocations: 0, invocationStorageChanges: 0 };
  }

  const events = await db.contractEventRecord.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  const tokenEvents = await db.tokenEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  const invocationStorageChanges = await db.invocationStorageChange.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  const invocations = await db.invocation.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return {
    events: events.count,
    tokenEvents: tokenEvents.count,
    invocations: invocations.count,
    invocationStorageChanges: invocationStorageChanges.count,
  };
}

/** Run pruning once and log the pruned row count. Never throws. */
export async function runPrune(
  days: number | null = RETENTION_DAYS,
  db: Db = prisma
): Promise<void> {
  if (days === null) return;
  try {
    const { events, tokenEvents, invocations, invocationStorageChanges } = await pruneOldRecords(
      days,
      db
    );
    metricRowsPruned.inc({ table: "contractEventRecord" }, events);
    metricRowsPruned.inc({ table: "tokenEvent" }, tokenEvents);
    metricRowsPruned.inc({ table: "invocation" }, invocations);
    metricRowsPruned.inc({ table: "invocationStorageChange" }, invocationStorageChanges);
    log.info("pruned expired indexer rows", {
      days,
      contractEvents: events,
      tokenEvents,
      invocations,
      invocationStorageChanges,
    });
  } catch (err) {
    log.error("retention pruning failed", { err });
  }
}

/** Prune now, then once per PRUNE_INTERVAL_MS until the returned timer is cleared. */
export function startPruneSchedule(
  days: number | null = RETENTION_DAYS,
  intervalMs: number = PRUNE_INTERVAL_MS
): NodeJS.Timeout | null {
  if (days === null) {
    log.info("retention pruning disabled; INDEXER_RETENTION_DAYS is unset");
    return null;
  }
  log.info("starting retention pruning", { days, intervalMs });
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
  const rows = await collectTransactionRows(transactions, CONTRACT_IDS, server);
  await client.$transaction(
    async (db) => {
      await insertTransactionRows(rows, db);
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
  failover.recordSuccess();
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
  const metricsServer = startMetricsServer();
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
          log.info("processed through ledger", { cursor });
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
      metricErrors.inc();
      delayMs = backoffDelay(consecutiveFailures);
      log.error("poll failed, retrying", { consecutiveFailures, retryInMs: delayMs, err });
    }
    if (!stopping) await sleep(delayMs);
  }

  log.info("shutting down", { cursor });
  if (pruneTimer) clearInterval(pruneTimer);
  await setCursor(cursor, paginationCursor);
  healthServer.close();
  metricsServer.close();
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
