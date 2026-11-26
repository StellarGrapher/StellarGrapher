import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TransactionCard from "./TransactionCard";
import type { TransactionRecord } from "@/types";

const successfulTx: TransactionRecord = {
  hash: "9f2c1d4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
  ledger: 1234567,
  createdAt: "2026-10-21T09:30:00Z",
  sourceAccount: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
  fee: 100,
  operationCount: 2,
  successful: true,
  envelopeXdr: "AAAAAgAAAAB=",
  resultXdr: "AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAA=",
};

const failedTx: TransactionRecord = {
  ...successfulTx,
  hash: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
  fee: 12345,
  operationCount: 1,
  successful: false,
};

describe("TransactionCard", () => {
  it("renders a successful transaction", () => {
    expect(renderToStaticMarkup(<TransactionCard tx={successfulTx} />)).toMatchSnapshot();
  });

  it("renders a failed transaction with a single operation", () => {
    expect(renderToStaticMarkup(<TransactionCard tx={failedTx} />)).toMatchSnapshot();
  });
});
