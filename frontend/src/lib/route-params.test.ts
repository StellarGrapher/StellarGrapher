/**
 * Security & format validation tests for contractId and txHash route params (#121).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidContractId, isValidTxHash } from "@/lib/route-params";

vi.mock("@/lib/soroban", () => ({
  getContractInfo: vi.fn(),
  getContractWasmInfo: vi.fn(),
  getContractEventsPage: vi.fn(),
  getInvocationHistoryPage: vi.fn(),
  simulateInvocation: vi.fn(),
  lookupStorageEntry: vi.fn(),
  parseStorageKeyInput: vi.fn(),
  getFullStorageEntries: vi.fn(),
  getInvocationReturnValue: vi.fn(),
  isRpcUnreachableError: vi.fn(() => false),
}));

vi.mock("@/lib/indexed-db", () => ({
  getIndexedGaps: vi.fn(),
  isIndexerConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/horizon", () => ({
  getTransaction: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn(() => null),
  rateLimitAsync: vi.fn(async () => ({ success: true })),
  getClientKey: vi.fn(() => "127.0.0.1"),
}));

import { GET as getContract } from "@/app/api/contract/[id]/route";
import { GET as getContractEvents } from "@/app/api/contract/[id]/events/route";
import { GET as getContractInvocations } from "@/app/api/contract/[id]/invocations/route";
import { POST as postContractSimulate } from "@/app/api/contract/[id]/simulate/route";
import { GET as getContractStorage } from "@/app/api/contract/[id]/storage/route";
import { GET as getContractFullStorage } from "@/app/api/contract/[id]/storage/full/route";
import { GET as getContractWasm } from "@/app/api/contract/[id]/wasm/route";
import { GET as getTx } from "@/app/api/tx/[hash]/route";

import {
  getContractInfo,
  getContractWasmInfo,
  getContractEventsPage,
  getInvocationHistoryPage,
  simulateInvocation,
  lookupStorageEntry,
  getFullStorageEntries,
} from "@/lib/soroban";
import { getIndexedGaps } from "@/lib/indexed-db";
import { getTransaction } from "@/lib/horizon";

const VALID_STRKEY = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const VALID_HEX = "a1b2c3d4".repeat(8);

const MALICIOUS_PAYLOADS = [
  "../etc/passwd",
  "..%2F..%2Fadmin",
  "%2e%2e%2fsecret",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM/../x",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM%00",
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", // Account G-strkey, not contract C-strkey
  "short-id",
  "",
];

describe("isValidContractId & isValidTxHash (#121)", () => {
  it("accepts 56-character C-strkey and 64-character hex contract IDs", () => {
    expect(isValidContractId(VALID_STRKEY)).toBe(true);
    expect(isValidContractId(VALID_HEX)).toBe(true);
    expect(isValidContractId(VALID_HEX.toUpperCase())).toBe(true);
  });

  it("rejects path traversal, URL-encoded slashes, and malformed contract IDs", () => {
    for (const bad of MALICIOUS_PAYLOADS) {
      expect(isValidContractId(bad)).toBe(false);
    }
  });

  it("accepts 64-character hex tx hashes and rejects traversal / non-hex inputs", () => {
    expect(isValidTxHash(VALID_HEX)).toBe(true);
    expect(isValidTxHash(VALID_HEX.toUpperCase())).toBe(true);
    expect(isValidTxHash(VALID_STRKEY)).toBe(false);
    for (const bad of MALICIOUS_PAYLOADS) {
      expect(isValidTxHash(bad)).toBe(false);
    }
  });
});

describe("API route handlers reject invalid contractId and txHash with 400 before RPC/DB calls (#121)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["../etc/passwd", "..%2F..%2Finternal", "C123%2F.."])(
    "returns 400 across all contract routes for malicious id %s",
    async (badId) => {
      const params = { params: { id: badId } };

      const r1 = await getContract(new Request("http://localhost/api/contract/x"), params);
      expect(r1.status).toBe(400);

      const r2 = await getContractEvents(new Request("http://localhost/api/contract/x/events"), params);
      expect(r2.status).toBe(400);

      const r3 = await getContractInvocations(new Request("http://localhost/api/contract/x/invocations"), params);
      expect(r3.status).toBe(400);

      const r4 = await postContractSimulate(
        new Request("http://localhost/api/contract/x/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ functionName: "hello" }),
        }),
        params,
      );
      expect(r4.status).toBe(400);

      const r5 = await getContractStorage(
        new Request("http://localhost/api/contract/x/storage?key=admin&kind=symbol"),
        params,
      );
      expect(r5.status).toBe(400);

      const r6 = await getContractFullStorage(
        new Request("http://localhost/api/contract/x/storage/full"),
        params,
      );
      expect(r6.status).toBe(400);

      const r7 = await getContractWasm(new Request("http://localhost/api/contract/x/wasm"), params);
      expect(r7.status).toBe(400);

      expect(getContractInfo).not.toHaveBeenCalled();
      expect(getContractWasmInfo).not.toHaveBeenCalled();
      expect(getIndexedGaps).not.toHaveBeenCalled();
      expect(getContractEventsPage).not.toHaveBeenCalled();
      expect(getInvocationHistoryPage).not.toHaveBeenCalled();
      expect(simulateInvocation).not.toHaveBeenCalled();
      expect(lookupStorageEntry).not.toHaveBeenCalled();
      expect(getFullStorageEntries).not.toHaveBeenCalled();
    },
  );

  it.each(["../etc/passwd", "..%2F..%2Ftx", "zz".repeat(32)])(
    "returns 400 on GET /api/tx/[hash] before Horizon call for %s",
    async (badHash) => {
      const res = await getTx(new Request("http://localhost/api/tx/x"), {
        params: { hash: badHash },
      });
      expect(res.status).toBe(400);
      expect(getTransaction).not.toHaveBeenCalled();
    },
  );
});
