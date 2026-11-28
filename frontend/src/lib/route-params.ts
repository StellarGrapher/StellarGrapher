/**
 * Route-parameter validators for Stellar / Soroban identifiers (#121).
 *
 * Rejects path-traversal sequences (`../`, `%2F`, null bytes, etc.) and
 * malformed identifiers before any RPC, Horizon, or database call runs.
 */

/** 56-character base32 Soroban contract StrKey (`C...`) or 64-character hex hash. */
export const CONTRACT_ID_REGEX = /^(?:C[A-Z2-7]{55}|[0-9a-fA-F]{64})$/;

/** 64-character hex Stellar transaction hash. */
export const TX_HASH_REGEX = /^[0-9a-fA-F]{64}$/;

export function isValidContractId(id: unknown): id is string {
  return typeof id === "string" && CONTRACT_ID_REGEX.test(id);
}

export function isValidTxHash(hash: unknown): hash is string {
  return typeof hash === "string" && TX_HASH_REGEX.test(hash);
}
