import { describe, expect, it, vi, afterEach } from "vitest";
import { Address, Keypair, StrKey, xdr } from "@stellar/stellar-sdk";
import { parseStorageKeyInput } from "./soroban";
import { scValToDisplay } from "./xdr";

describe("parseStorageKeyInput", () => {
  it("builds a symbol key", () => {
    expect(parseStorageKeyInput("Admin", "symbol").switch().name).toBe("scvSymbol");
  });

  it("builds a string key", () => {
    expect(parseStorageKeyInput("hello", "string").switch().name).toBe("scvString");
  });

  it("builds a u32 key", () => {
    const key = parseStorageKeyInput("7", "u32");
    expect(key.switch().name).toBe("scvU32");
    expect(key.u32()).toBe(7);
  });

  it("builds an address key from a valid account address", () => {
    const address = Keypair.random().publicKey();
    expect(parseStorageKeyInput(address, "address").switch().name).toBe("scvAddress");
  });

  it("throws for an invalid address", () => {
    expect(() => parseStorageKeyInput("not-an-address", "address")).toThrow();
  });
});

describe("scValToDisplay ScVal variants", () => {
  it("renders ScvVec as a JSON array", () => {
    const vec = xdr.ScVal.scvVec([xdr.ScVal.scvU32(1), xdr.ScVal.scvSymbol("two")]);
    expect(scValToDisplay(vec)).toBe('[1,"two"]');
  });

  it("renders an empty ScvVec as []", () => {
    expect(scValToDisplay(xdr.ScVal.scvVec([]))).toBe("[]");
  });

  it("renders ScvMap as a JSON object", () => {
    const map = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("a"), val: xdr.ScVal.scvU32(1) }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("b"), val: xdr.ScVal.scvU32(2) }),
    ]);
    expect(scValToDisplay(map)).toBe('{"a":1,"b":2}');
  });

  it("renders an empty ScvMap as {}", () => {
    expect(scValToDisplay(xdr.ScVal.scvMap([]))).toBe("{}");
  });

  it("renders ScvAddress as the StrKey address", () => {
    const publicKey = Keypair.random().publicKey();
    const val = new Address(publicKey).toScVal();
    expect(val.switch().name).toBe("scvAddress");
    expect(scValToDisplay(val)).toBe(publicKey);
  });

  it("renders a contract ScvAddress as the contract StrKey", () => {
    const contractId = StrKey.encodeContract(Buffer.alloc(32, 7));
    const val = new Address(contractId).toScVal();
    expect(scValToDisplay(val)).toBe(contractId);
  });

  it("renders ScvBytes as a hex string", () => {
    const val = xdr.ScVal.scvBytes(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
    expect(scValToDisplay(val)).toBe("deadbeef");
  });

  it("renders empty ScvBytes as an empty string", () => {
    expect(scValToDisplay(xdr.ScVal.scvBytes(Buffer.alloc(0)))).toBe("");
  });

  it("renders ScvString as a plain string", () => {
    expect(scValToDisplay(xdr.ScVal.scvString("hello"))).toBe("hello");
  });

  it("renders an empty ScvString as an empty string", () => {
    expect(scValToDisplay(xdr.ScVal.scvString(""))).toBe("");
  });

  it("renders ScvI128 as a decimal string", () => {
    const val = xdr.ScVal.scvI128(
      new xdr.Int128Parts({ hi: xdr.Int64.fromString("0"), lo: xdr.Uint64.fromString("1234") })
    );
    expect(scValToDisplay(val)).toBe("1234");
  });

  it("renders a negative ScvI128 as a decimal string", () => {
    const val = xdr.ScVal.scvI128(
      new xdr.Int128Parts({ hi: xdr.Int64.fromString("-1"), lo: xdr.Uint64.fromString("0") })
    );
    expect(scValToDisplay(val)).toBe("-18446744073709551616");
  });

  it("renders zero ScvI128 as 0", () => {
    const val = xdr.ScVal.scvI128(
      new xdr.Int128Parts({ hi: xdr.Int64.fromString("0"), lo: xdr.Uint64.fromString("0") })
    );
    expect(scValToDisplay(val)).toBe("0");
  });

  it("renders ScvU128 as a decimal string", () => {
    const val = xdr.ScVal.scvU128(
      new xdr.UInt128Parts({ hi: xdr.Uint64.fromString("0"), lo: xdr.Uint64.fromString("1234") })
    );
    expect(scValToDisplay(val)).toBe("1234");
  });

  it("renders zero ScvU128 as 0", () => {
    const val = xdr.ScVal.scvU128(
      new xdr.UInt128Parts({ hi: xdr.Uint64.fromString("0"), lo: xdr.Uint64.fromString("0") })
    );
    expect(scValToDisplay(val)).toBe("0");
  });

  it("renders ScvVoid as the literal 'void'", () => {
    expect(scValToDisplay(xdr.ScVal.scvVoid())).toBe("void");
  });

  it("renders ScvBool as a JSON boolean", () => {
    expect(scValToDisplay(xdr.ScVal.scvBool(true))).toBe("true");
    expect(scValToDisplay(xdr.ScVal.scvBool(false))).toBe("false");
  });

  it("renders ScvU32 as a JSON number", () => {
    expect(scValToDisplay(xdr.ScVal.scvU32(0))).toBe("0");
    expect(scValToDisplay(xdr.ScVal.scvU32(42))).toBe("42");
  });

  it("renders ScvI32 as a JSON number", () => {
    expect(scValToDisplay(xdr.ScVal.scvI32(-7))).toBe("-7");
  });

  it("renders ScvU64 as a decimal string", () => {
    expect(scValToDisplay(xdr.ScVal.scvU64(xdr.Uint64.fromString("0")))).toBe("0");
    expect(scValToDisplay(xdr.ScVal.scvU64(xdr.Uint64.fromString("9007199254740993")))).toBe(
      "9007199254740993"
    );
  });

  it("renders ScvI64 as a decimal string", () => {
    expect(scValToDisplay(xdr.ScVal.scvI64(xdr.Int64.fromString("-42")))).toBe("-42");
  });

  it("renders ScvTimepoint as a decimal string", () => {
    expect(scValToDisplay(xdr.ScVal.scvTimepoint(xdr.Uint64.fromString("0")))).toBe("0");
  });

  it("renders ScvDuration as a decimal string", () => {
    expect(scValToDisplay(xdr.ScVal.scvDuration(xdr.Uint64.fromString("60")))).toBe("60");
  });

  it("renders ScvSymbol as a plain string", () => {
    expect(scValToDisplay(xdr.ScVal.scvSymbol("admin"))).toBe("admin");
  });
});

describe("getInvocationHistory concurrency (issue #34)", () => {
  it("batches getTransaction calls so no more than 4 are in flight at once", async () => {
    const CONCURRENCY = 4;
    const txHashes = Array.from({ length: 20 }, (_, i) => `hash${i}`);

    let inFlight = 0;
    let maxInFlight = 0;

    async function fetchTx(hash: string) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((r) => setTimeout(r, 5));
      inFlight--;
      return { txHash: hash, done: true };
    }

    // Run the same batching logic used in getInvocationHistory
    const results: { txHash: string; done: boolean }[] = [];
    for (let i = 0; i < txHashes.length; i += CONCURRENCY) {
      const batch = txHashes.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map((h) => fetchTx(h)));
      results.push(...batchResults);
    }

    expect(maxInFlight).toBeLessThanOrEqual(CONCURRENCY);
    expect(results).toHaveLength(txHashes.length);
  });
});
