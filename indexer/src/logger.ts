// ---------------------------------------------------------------------------
// Structured JSON logging (#81)
// ---------------------------------------------------------------------------
//
// One JSON object per line on stdout (stderr for warn/error), so Loki,
// CloudWatch or any other aggregator can ingest the indexer's output without a
// regex per message. Every line carries `level`, `timestamp`, `service` and
// `msg`; anything else is context passed by the call site as fields rather than
// interpolated into the message, which is what makes a log searchable.
//
// Deliberately dependency-free. pino would do this too, but adding a runtime
// dependency means a lockfile change, and this is forty lines.

export type Level = "debug" | "info" | "warn" | "error";

const SEVERITY: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SERVICE = "indexer";

/**
 * The lowest level that is written, from `LOG_LEVEL` (default `info`).
 *
 * An unrecognised value falls back to `info` rather than failing the process:
 * a typo in an env var should not take the indexer down, and a silent logger
 * would be worse than a noisy one.
 */
function thresholdFrom(raw: string | undefined): number {
  const level = (raw ?? "").trim().toLowerCase();
  return level in SEVERITY ? SEVERITY[level as Level] : SEVERITY.info;
}

let threshold = thresholdFrom(process.env.LOG_LEVEL);

/** Re-reads `LOG_LEVEL`. Exported for tests; the process reads it once at import. */
export function configureFromEnv(raw: string | undefined = process.env.LOG_LEVEL): void {
  threshold = thresholdFrom(raw);
}

/** An Error does not survive JSON.stringify — keep the parts worth searching. */
function plain(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

export type Context = Record<string, unknown>;

function write(level: Level, msg: string, context: Context = {}): void {
  if (SEVERITY[level] < threshold) return;

  const line: Record<string, unknown> = {
    level,
    timestamp: new Date().toISOString(),
    service: SERVICE,
    msg,
  };
  for (const [key, value] of Object.entries(context)) {
    // Never let a context field overwrite the envelope: a caller passing
    // `level` would otherwise produce a line that lies about its own severity.
    if (key in line) continue;
    line[key] = plain(value);
  }

  let text: string;
  try {
    text = JSON.stringify(line);
  } catch {
    // A circular or otherwise unserialisable context must not lose the message.
    text = JSON.stringify({ level, timestamp: line.timestamp, service: SERVICE, msg, contextError: "not serialisable" });
  }

  const stream = level === "warn" || level === "error" ? process.stderr : process.stdout;
  stream.write(`${text}\n`);
}

export const log = {
  debug: (msg: string, context?: Context) => write("debug", msg, context),
  info: (msg: string, context?: Context) => write("info", msg, context),
  warn: (msg: string, context?: Context) => write("warn", msg, context),
  error: (msg: string, context?: Context) => write("error", msg, context),
};
