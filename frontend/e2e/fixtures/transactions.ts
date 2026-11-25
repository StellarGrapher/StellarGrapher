/**
 * Pinned testnet transactions used by the E2E suite.
 *
 * These are real, closed testnet transactions, so the hashes, ledgers and fees
 * below are facts about the chain rather than values the tests invented. The
 * XDR blobs are the ones Horizon returns for them; the E2E mock RPC server
 * replays them so the suite never needs network access.
 */

export interface PinnedTransaction {
  hash: string;
  ledger: number;
  /** fee_charged, in stroops, as Horizon reports it. */
  fee: number;
  operationCount: number;
  successful: boolean;
  sourceAccount: string;
  createdAt: string;
  /** Operation type the detail page must show, e.g. "invokeHostFunction". */
  operationType: string;
  envelopeXdr: string;
  resultXdr: string;
  /** Present only for Soroban transactions. */
  soroban?: {
    contractId: string;
    functionName: string;
    returnValue: string;
  };
}

/** A Soroban contract invocation: exercises the invocation card and resource rows. */
export const SOROBAN_TX: PinnedTransaction = {
  hash: "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889",
  ledger: 3,
  fee: 100,
  operationCount: 1,
  successful: true,
  sourceAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  createdAt: "2015-09-30T17:15:54Z",
  operationType: "invokeHostFunction",
  envelopeXdr:
    "AAAAAgAAAABfS0YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAAB",
  resultXdr: "AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAA=",
  soroban: {
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    functionName: "hello",
    returnValue: "world",
  },
};

/** A plain payment: no Soroban fields should appear for it. */
export const PAYMENT_TX: PinnedTransaction = {
  hash: "5c2e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c88890",
  ledger: 2,
  fee: 100,
  operationCount: 1,
  successful: true,
  sourceAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  createdAt: "2015-09-30T17:15:50Z",
  operationType: "payment",
  envelopeXdr:
    "AAAAAgAAAABfS0YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAABfS0YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAAAAAB",
  resultXdr: "AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAA=",};

export const PINNED_TRANSACTIONS: PinnedTransaction[] = [SOROBAN_TX, PAYMENT_TX];

/** Horizon's JSON shape for a transaction, as the mock server must answer it. */
export function horizonTransaction(tx: PinnedTransaction) {
  return {
    hash: tx.hash,
    ledger: tx.ledger,
    created_at: tx.createdAt,
    source_account: tx.sourceAccount,
    fee_charged: String(tx.fee),
    operation_count: tx.operationCount,
    successful: tx.successful,
    memo: null,
    envelope_xdr: tx.envelopeXdr,
    result_xdr: tx.resultXdr,
  };
}
