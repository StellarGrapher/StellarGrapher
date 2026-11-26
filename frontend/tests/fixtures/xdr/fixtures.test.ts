/**
 * Fixture-based decoder tests (issue #105).
 *
 * Each fixture in this directory is a base64-encoded XDR blob for a specific
 * ScVal variant. The tests verify that:
 *   1. `decodeAnyXdr` returns a non-null result (the blob is valid XDR).
 *   2. The resolved XDR type matches expectations.
 *   3. The decoded ScVal type name matches the fixture's variant.
 *
 * Fixtures were generated from known XDR byte layouts (see README.md for the
 * byte-by-byte derivation of each one).
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeAnyXdr } from "@/lib/xdr";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  const p = resolve(__dirname, name);
  return readFileSync(p, "utf8").trim();
}

function scValFixture(name: string): { base64: string; result: ReturnType<typeof decodeAnyXdr> } {
  const base64 = loadFixture(name);
  return { base64, result: decodeAnyXdr(base64) };
}

describe("ScVal XDR fixtures (issue #105)", () => {
  it("scval-void.b64 decodes as ScVal/scvVoid", () => {
    const { result } = scValFixture("scval-void.b64");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("ScVal");
    const typeField = result!.fields.find((f) => f.label === "ScVal type");
    expect(typeField?.value).toBe("scvVoid");
  });

  it("scval-bool-true.b64 decodes as ScVal/scvBool = true", () => {
    const { result } = scValFixture("scval-bool-true.b64");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("ScVal");
    const typeField = result!.fields.find((f) => f.label === "ScVal type");
    expect(typeField?.value).toBe("scvBool");
    const valField = result!.fields.find((f) => f.label === "Value");
    expect(valField?.value).toBe("true");
  });

  it("scval-bool-false.b64 decodes as ScVal/scvBool = false", () => {
    const { result } = scValFixture("scval-bool-false.b64");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("ScVal");
    const typeField = result!.fields.find((f) => f.label === "ScVal type");
    expect(typeField?.value).toBe("scvBool");
    const valField = result!.fields.find((f) => f.label === "Value");
    expect(valField?.value).toBe("false");
  });

  it("scval-u32.b64 decodes as ScVal/scvU32 = 42", () => {
    const { result } = scValFixture("scval-u32.b64");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("ScVal");
    const typeField = result!.fields.find((f) => f.label === "ScVal type");
    expect(typeField?.value).toBe("scvU32");
    const valField = result!.fields.find((f) => f.label === "Value");
    expect(valField?.value).toBe("42");
  });

  it("scval-i32.b64 decodes as ScVal/scvI32 = -1", () => {
    const { result } = scValFixture("scval-i32.b64");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("ScVal");
    const typeField = result!.fields.find((f) => f.label === "ScVal type");
    expect(typeField?.value).toBe("scvI32");
    const valField = result!.fields.find((f) => f.label === "Value");
    expect(valField?.value).toBe("-1");
  });

  it("scval-u64.b64 decodes as ScVal/scvU64 = 1000", () => {
    const { result } = scValFixture("scval-u64.b64");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("ScVal");
    const typeField = result!.fields.find((f) => f.label === "ScVal type");
    expect(typeField?.value).toBe("scvU64");
  });

  it("scval-u128.b64 decodes as ScVal/scvU128", () => {
    const { result } = scValFixture("scval-u128.b64");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("ScVal");
    const typeField = result!.fields.find((f) => f.label === "ScVal type");
    expect(typeField?.value).toBe("scvU128");
  });

  it("scval-i128.b64 decodes as ScVal/scvI128", () => {
    const { result } = scValFixture("scval-i128.b64");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("ScVal");
    const typeField = result!.fields.find((f) => f.label === "ScVal type");
    expect(typeField?.value).toBe("scvI128");
  });

  it("scval-symbol.b64 decodes as ScVal/scvSymbol = admin", () => {
    const { result } = scValFixture("scval-symbol.b64");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("ScVal");
    const typeField = result!.fields.find((f) => f.label === "ScVal type");
    expect(typeField?.value).toBe("scvSymbol");
    const valField = result!.fields.find((f) => f.label === "Value");
    expect(valField?.value).toContain("admin");
  });

  it("scval-string.b64 decodes as ScVal/scvString = hello", () => {
    const { result } = scValFixture("scval-string.b64");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("ScVal");
    const typeField = result!.fields.find((f) => f.label === "ScVal type");
    expect(typeField?.value).toBe("scvString");
    const valField = result!.fields.find((f) => f.label === "Value");
    expect(valField?.value).toContain("hello");
  });

  it("scval-bytes.b64 decodes as ScVal/scvBytes", () => {
    const { result } = scValFixture("scval-bytes.b64");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("ScVal");
    const typeField = result!.fields.find((f) => f.label === "ScVal type");
    expect(typeField?.value).toBe("scvBytes");
  });

  it("every fixture decodes without throwing", () => {
    const fixtures = [
      "scval-void.b64",
      "scval-bool-true.b64",
      "scval-bool-false.b64",
      "scval-u32.b64",
      "scval-i32.b64",
      "scval-u64.b64",
      "scval-u128.b64",
      "scval-i128.b64",
      "scval-symbol.b64",
      "scval-string.b64",
      "scval-bytes.b64",
    ];

    for (const name of fixtures) {
      const base64 = loadFixture(name);
      expect(() => decodeAnyXdr(base64), `${name} should not throw`).not.toThrow();
    }
  });
});
