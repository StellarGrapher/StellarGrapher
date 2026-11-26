import { describe, expect, it } from "vitest";
import { resolveSearchRoute } from "./search";

const TX = "a".repeat(64);
const CONTRACT = "C" + "A".repeat(55);
const ACCOUNT = "G" + "A".repeat(55);

describe("resolveSearchRoute", () => {
  it("routes a 64-char hex string to /tx", () => {
    expect(resolveSearchRoute(TX)).toBe(`/tx/${TX}`);
  });

  it("routes a C-strkey to /contract", () => {
    expect(resolveSearchRoute(CONTRACT)).toBe(`/contract/${CONTRACT}`);
  });

  it("routes a G-strkey to /account", () => {
    expect(resolveSearchRoute(ACCOUNT)).toBe(`/account/${ACCOUNT}`);
  });

  it("routes a decimal string to /ledger", () => {
    expect(resolveSearchRoute("1234567")).toBe("/ledger/1234567");
  });

  it("routes an unrecognised query to /search", () => {
    expect(resolveSearchRoute("hello world")).toBe("/search?q=hello%20world");
  });

  it("rejects a 56-char string starting with C but containing non-base32 chars", () => {
    // Lowercase letters are not valid base-32 — should fall through to /search
    const bad = "C" + "a".repeat(55);
    expect(resolveSearchRoute(bad)).toBe(`/search?q=${encodeURIComponent(bad)}`);
  });

  it("rejects a 56-char string starting with C but wrong length", () => {
    const short = "C" + "A".repeat(50);
    expect(resolveSearchRoute(short)).toBe(`/search?q=${encodeURIComponent(short)}`);
  });

  it("trims whitespace before routing", () => {
    expect(resolveSearchRoute("  " + TX + "  ")).toBe(`/tx/${TX}`);
  });

  it("returns null for empty input", () => {
    expect(resolveSearchRoute("")).toBeNull();
    expect(resolveSearchRoute("   ")).toBeNull();
  });

  describe("transaction hash", () => {
    it("accepts uppercase hex", () => {
      const upper = "A".repeat(64);
      expect(resolveSearchRoute(upper)).toBe(`/tx/${upper}`);
    });

    it("rejects a hash that is too short", () => {
      const short = "a".repeat(63);
      expect(resolveSearchRoute(short)).toBe(`/search?q=${short}`);
    });

    it("rejects a hash that is too long", () => {
      const long = "a".repeat(65);
      expect(resolveSearchRoute(long)).toBe(`/search?q=${long}`);
    });

    it("rejects a 64-char string with non-hex characters", () => {
      const bad = "g".repeat(64);
      expect(resolveSearchRoute(bad)).toBe(`/search?q=${bad}`);
    });
  });

  describe("contract ID", () => {
    it("accepts a C-strkey containing digits 2-7", () => {
      const id = "C" + "234567".repeat(9) + "2";
      expect(id).toHaveLength(56);
      expect(resolveSearchRoute(id)).toBe(`/contract/${id}`);
    });

    it("rejects a C-strkey containing 0 or 1", () => {
      const bad = "C" + "0".repeat(55);
      expect(resolveSearchRoute(bad)).toBe(`/search?q=${bad}`);
    });

    it("rejects a C-strkey that is too long", () => {
      const long = "C" + "A".repeat(56);
      expect(resolveSearchRoute(long)).toBe(`/search?q=${long}`);
    });
  });

  describe("account address", () => {
    it("rejects a G-strkey containing non-base32 characters", () => {
      const bad = "G" + "a".repeat(55);
      expect(resolveSearchRoute(bad)).toBe(`/search?q=${encodeURIComponent(bad)}`);
    });

    it("rejects a G-strkey that is too short", () => {
      const short = "G" + "A".repeat(54);
      expect(resolveSearchRoute(short)).toBe(`/search?q=${short}`);
    });

    it("rejects a G-strkey containing 0 or 1", () => {
      const bad = "G" + "1".repeat(55);
      expect(resolveSearchRoute(bad)).toBe(`/search?q=${bad}`);
    });
  });

  describe("ledger sequence", () => {
    it("routes a single-digit sequence", () => {
      expect(resolveSearchRoute("1")).toBe("/ledger/1");
    });

    it("routes a long sequence", () => {
      const seq = "9".repeat(20);
      expect(resolveSearchRoute(seq)).toBe(`/ledger/${seq}`);
    });

    it("rejects a negative number", () => {
      expect(resolveSearchRoute("-42")).toBe("/search?q=-42");
    });

    it("rejects a decimal with a fractional part", () => {
      expect(resolveSearchRoute("12.5")).toBe("/search?q=12.5");
    });

    it("rejects a number with a hex prefix", () => {
      expect(resolveSearchRoute("0x1f")).toBe("/search?q=0x1f");
    });

    it("rejects a number with surrounding letters", () => {
      expect(resolveSearchRoute("ledger 42")).toBe("/search?q=ledger%2042");
    });
  });

  describe("ambiguous inputs", () => {
    it("prefers /tx for a 64-char hex string that is all digits", () => {
      const digits = "1".repeat(64);
      expect(resolveSearchRoute(digits)).toBe(`/tx/${digits}`);
    });

    it("prefers /contract over /account for a C-strkey", () => {
      expect(resolveSearchRoute(CONTRACT)).toBe(`/contract/${CONTRACT}`);
    });

    it("prefers /account over /ledger for a G-strkey", () => {
      expect(resolveSearchRoute(ACCOUNT)).toBe(`/account/${ACCOUNT}`);
    });

    it("routes a 56-char hex string to /search, not /tx", () => {
      const hex56 = "a".repeat(56);
      expect(resolveSearchRoute(hex56)).toBe(`/search?q=${hex56}`);
    });

    it("routes a 64-char base32 string to /search, not /contract", () => {
      const base32 = "C" + "A".repeat(63);
      expect(resolveSearchRoute(base32)).toBe(`/search?q=${base32}`);
    });
  });
});
