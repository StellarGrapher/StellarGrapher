import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LedgerStats from "./LedgerStats";
import type { LedgerRecord } from "@/types";

const ledger: LedgerRecord = {
  sequence: 1234567,
  hash: "b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8",
  closedAt: "2026-10-21T09:30:00Z",
  transactionCount: 42,
  operationCount: 87,
  baseFee: 100,
  successfulTransactionCount: 40,
  failedTransactionCount: 2,
};

describe("LedgerStats", () => {
  it("renders the ledger summary tiles", () => {
    expect(renderToStaticMarkup(<LedgerStats ledger={ledger} />)).toMatchSnapshot();
  });
});
