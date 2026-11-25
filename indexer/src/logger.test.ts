import { afterEach, describe, expect, it, vi } from "vitest";
import { configureFromEnv, log } from "./logger.js";

/** Captures the lines one call writes, as parsed JSON. */
function capture(fn: () => void): Record<string, unknown>[] {
  const lines: string[] = [];
  const grab = (chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  };
  const out = vi.spyOn(process.stdout, "write").mockImplementation(grab as never);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(grab as never);
  try {
    fn();
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("logger", () => {
  afterEach(() => configureFromEnv("debug"));

  it("writes one JSON object per line with the envelope every aggregator needs", () => {
    configureFromEnv("info");
    const [line, ...rest] = capture(() => log.info("processed through ledger", { cursor: 42 }));

    expect(rest).toHaveLength(0);
    expect(line).toMatchObject({
      level: "info",
      service: "indexer",
      msg: "processed through ledger",
      cursor: 42,
    });
    expect(typeof line!.timestamp).toBe("string");
    expect(new Date(line!.timestamp as string).toISOString()).toBe(line!.timestamp);
  });

  it("keeps context as fields rather than interpolating them into the message", () => {
    configureFromEnv("info");
    const [line] = capture(() => log.warn("ledger is before the retention window", { requestedLedger: 7, oldestAvailable: 99 }));

    expect(line).toMatchObject({ requestedLedger: 7, oldestAvailable: 99 });
    expect(line!.msg).not.toContain("7");
  });

  it("obeys LOG_LEVEL", () => {
    configureFromEnv("warn");
    expect(capture(() => log.debug("quiet"))).toHaveLength(0);
    expect(capture(() => log.info("quiet"))).toHaveLength(0);
    expect(capture(() => log.warn("loud"))).toHaveLength(1);
    expect(capture(() => log.error("loud"))).toHaveLength(1);
  });

  it("falls back to info when LOG_LEVEL is missing or nonsense, instead of going silent", () => {
    for (const value of [undefined, "", "lowd"]) {
      configureFromEnv(value);
      expect(capture(() => log.debug("below info"))).toHaveLength(0);
      expect(capture(() => log.info("at info"))).toHaveLength(1);
    }
  });

  it("serialises an Error, which JSON.stringify would otherwise flatten to {}", () => {
    configureFromEnv("info");
    const [line] = capture(() => log.error("poll failed, retrying", { err: new Error("rpc unreachable") }));

    expect(line!.err).toMatchObject({ name: "Error", message: "rpc unreachable" });
    expect(typeof (line!.err as Record<string, unknown>).stack).toBe("string");
  });

  it("never lets a context field overwrite the envelope", () => {
    configureFromEnv("info");
    const [line] = capture(() => log.info("real message", { level: "error", service: "somewhere-else", msg: "overwritten" }));

    expect(line).toMatchObject({ level: "info", service: "indexer", msg: "real message" });
  });

  it("still writes the message when the context cannot be serialised", () => {
    configureFromEnv("info");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const [line] = capture(() => log.info("kept the message", { circular }));

    expect(line).toMatchObject({ level: "info", service: "indexer", msg: "kept the message", contextError: "not serialisable" });
  });
});
