/**
 * Fuzz harness for the XDR decoder (issue #102).
 *
 * Sends 10 000 random base64-encoded byte sequences through `decodeAnyXdr` and
 * verifies that the function never throws an unhandled exception. Valid XDR may
 * decode to a result object; invalid XDR must return null — never crash.
 *
 * Seeds are fixed so a CI failure reproduces exactly. Add a new seed here to
 * cover a newly discovered crashing input.
 */

import { describe, expect, it } from "vitest";
import { decodeAnyXdr } from "@/lib/xdr";

/** Deterministic PRNG (mulberry32), returns floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBytes(length: number, rand: () => number): Uint8Array {
  const buf = new Uint8Array(length);
  for (let i = 0; i < length; i++) buf[i] = Math.floor(rand() * 256);
  return buf;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
const RUNS_PER_SEED = 1_000; // 10 seeds × 1 000 = 10 000 inputs total

describe("XDR decoder fuzz (issue #102)", () => {
  for (const seed of SEEDS) {
    it(`survives 1 000 random inputs with seed ${seed}`, () => {
      const rand = mulberry32(seed);
      let crashed = false;

      for (let i = 0; i < RUNS_PER_SEED; i++) {
        // Vary the length to exercise short, medium, and large payloads
        const len = 1 + Math.floor(rand() * 512);
        const input = toBase64(randomBytes(len, rand));

        try {
          const result = decodeAnyXdr(input);
          // Result must be null (not valid XDR) or a non-null object — never an exception
          expect(result === null || typeof result === "object").toBe(true);
        } catch {
          crashed = true;
          // Fail with the crashing input so it can be added as a regression fixture
          expect.fail(
            `decodeAnyXdr threw for seed=${seed} i=${i} input="${input.slice(0, 40)}…"`
          );
        }
      }

      expect(crashed).toBe(false);
    });
  }
});
