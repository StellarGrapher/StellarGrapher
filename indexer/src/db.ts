import { Prisma, PrismaClient } from "@prisma/client";
import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Slow-query logging and connection pool monitoring (#85)
// ---------------------------------------------------------------------------

/** Default slow-query threshold in milliseconds. */
export const DEFAULT_SLOW_QUERY_MS = 500;

/** Slow-query threshold from `SLOW_QUERY_MS`; unset or invalid falls back to the default. */
export function slowQueryThresholdMs(raw: string | undefined = process.env.SLOW_QUERY_MS): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_SLOW_QUERY_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    log.warn("invalid slow-query threshold; using default", {
      envVar: "SLOW_QUERY_MS",
      value: raw,
      defaultMs: DEFAULT_SLOW_QUERY_MS,
    });
    return DEFAULT_SLOW_QUERY_MS;
  }
  return n;
}

export const SLOW_QUERY_MS = slowQueryThresholdMs();

const REDACTED = "[redacted]";

/**
 * Redact parameter values from a Prisma query event. Prisma renders params as a
 * JSON array; each value is replaced so query text stays readable but no data
 * (addresses, keys, payloads) leaks into logs.
 */
export function redactParams(params: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(params);
  } catch {
    return REDACTED;
  }
  if (!Array.isArray(parsed)) return REDACTED;
  return JSON.stringify(parsed.map(() => REDACTED));
}

export interface SlowQueryEvent {
  query: string;
  params: string;
  duration: number;
}

/** Log a query that exceeded the threshold, with its params redacted. */
export function logSlowQuery(event: SlowQueryEvent, thresholdMs: number = SLOW_QUERY_MS): void {
  if (event.duration < thresholdMs) return;
  log.warn("slow database query", {
    durationMs: event.duration,
    thresholdMs,
    query: event.query,
    params: redactParams(event.params),
  });
}

export interface PoolWaitEvent {
  wait: number;
  queueDepth: number;
}

/** Log how long a query waited for a pooled connection when the pool was contended. */
export function logPoolWait(event: PoolWaitEvent): void {
  if (event.queueDepth <= 0) return;
  log.warn("database pool wait", { waitMs: event.wait, queueDepth: event.queueDepth });
}

export const prisma = new PrismaClient({
  log: [{ emit: "event", level: "query" }],
});

prisma.$on("query", (event) => {
  logSlowQuery({ query: event.query, params: event.params, duration: event.duration });
});

/**
 * Prisma does not expose pool queue depth, so sample it from Postgres itself:
 * `pg_stat_activity` counts backends waiting on a lock or a client, and
 * `numbackends` vs. the configured pool size shows saturation. When the pool is
 * saturated, log how long the sample query had to wait for a connection.
 */
export function startPoolMonitor(
  client: Pick<PrismaClient, "$queryRawUnsafe"> = prisma,
  intervalMs = 10_000
): () => void {
  const timer = setInterval(() => {
    const startedAt = Date.now();
    void client
      .$queryRawUnsafe<{ waiting: bigint; total: bigint }[]>(
        `SELECT count(*) FILTER (WHERE wait_event_type IS NOT NULL) AS waiting,
                count(*) AS total
           FROM pg_stat_activity
          WHERE datname = current_database()`
      )
      .then((rows) => {
        const row = rows[0];
        if (!row) return;
        const queueDepth = Number(row.waiting);
        logPoolWait({ wait: Date.now() - startedAt, queueDepth });
      })
      .catch((err: unknown) => {
        log.warn("database pool monitor sample failed", { err });
      });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** The shared client, or the client of an open transaction. */
export type Db = Prisma.TransactionClient;

export interface IndexerCursor {
  lastLedger: number;
  paginationCursor: string | null;
}

export async function findCursor(): Promise<IndexerCursor | null> {
  return prisma.indexerCursor.findUnique({ where: { id: 1 } });
}

/** Create the cursor on a fresh database; `lastLedger` is the last ledger already treated as processed. */
export async function seedCursor(lastLedger: number): Promise<IndexerCursor> {
  return prisma.indexerCursor.create({ data: { id: 1, lastLedger } });
}

export async function setCursor(
  ledger: number,
  paginationCursor: string | null,
  db: Db = prisma
): Promise<void> {
  await db.indexerCursor.upsert({
    where: { id: 1 },
    update: { lastLedger: ledger, paginationCursor },
    create: { id: 1, lastLedger: ledger, paginationCursor },
  });
}

export async function getBackfillCursor(fromLedger: number, toLedger: number) {
  const existing = await prisma.backfillCursor.findUnique({ where: { id: 1 } });
  if (existing && !existing.completed) {
    if (existing.fromLedger !== fromLedger || existing.toLedger !== toLedger) {
      throw new Error(
        `Backfill ${existing.fromLedger}-${existing.toLedger} is incomplete; resume that range before starting another.`
      );
    }
    return existing;
  }
  if (existing?.completed && existing.fromLedger === fromLedger && existing.toLedger === toLedger) {
    return existing;
  }
  return prisma.backfillCursor.upsert({
    where: { id: 1 },
    update: {
      fromLedger,
      toLedger,
      lastLedger: fromLedger - 1,
      paginationCursor: null,
      completed: false,
    },
    create: {
      id: 1,
      fromLedger,
      toLedger,
      lastLedger: fromLedger - 1,
      paginationCursor: null,
      completed: false,
    },
  });
}

/** The incomplete backfill checkpoint, if any. */
export async function findIncompleteBackfill() {
  const existing = await prisma.backfillCursor.findUnique({ where: { id: 1 } });
  return existing && !existing.completed ? existing : null;
}

/** Drop the backfill checkpoint row once a range has completed. */
export async function clearBackfillCursor(): Promise<void> {
  await prisma.backfillCursor.deleteMany({ where: { id: 1 } });
}

export async function setBackfillCursor(
  fromLedger: number,
  toLedger: number,
  lastLedger: number,
  paginationCursor: string | null,
  completed: boolean
): Promise<void> {
  await prisma.backfillCursor.upsert({
    where: { id: 1 },
    update: { lastLedger, paginationCursor, completed },
    create: { id: 1, fromLedger, toLedger, lastLedger, paginationCursor, completed },
  });
}

/**
 * Security review (#126): Postgres query parameterization.
 *
 * All indexer database access goes through the Prisma Client query builder
 * (findUnique / create / upsert above), which emits parameterized SQL with
 * values bound as placeholders — never string-interpolated into the query.
 *
 * There are currently no `$queryRaw` / `$executeRaw` calls in the indexer.
 * If raw SQL is ever added, it MUST use the `Prisma.sql` tagged template so
 * values are bound as parameters, e.g.:
 *
 *   await prisma.$queryRaw(Prisma.sql`SELECT * FROM "IndexerCursor" WHERE id = ${id}`);
 *
 * Never build SQL via string concatenation or template interpolation of
 * user-controlled values (e.g. `$queryRawUnsafe("..." + value)`).
 */
export const RAW_SQL_POLICY = "Prisma.sql" as const;
