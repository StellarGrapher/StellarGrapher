import { NextResponse } from "next/server";
import { getContractWasmInfo, simulateInvocation } from "@/lib/soroban";
import { coerceArgInput } from "@/lib/xdr";
import { rateLimitRequest } from "@/lib/rate-limit";
import type { ContractTypeDef } from "@/types";

export const dynamic = "force-dynamic";

/** Keep simulation payloads bounded while allowing larger structured arguments. */
const MAX_BODY_BYTES = 1024 * 1024;

interface Params { params: { id: string } }

interface SimulateBody {
  functionName?: string;
  args?: { value: string; type: string }[];
  /**
   * Optional contract type definitions (structs, unions, enums) used to
   * coerce structured arguments correctly — the same path the UI takes via
   * the server action. When omitted, Prism fetches the types from the WASM
   * (using the cached result when available) so API callers get the same
   * coercion quality as the UI without having to supply the types themselves.
   */
  types?: ContractTypeDef[];
}

/**
 * Gas estimation surfaced to the invocation tool after a dry-run simulation.
 * Values are sourced from the `simulateTransaction` response so the UI can
 * show a fee breakdown before the user submits the transaction.
 */
interface GasEstimate {
  cpuInstructions: number;
  memoryBytes: number;
  ledgerReads: number;
  ledgerWrites: number;
  fee: string;
}

/**
 * Read the request body, giving up as soon as it passes `maxBytes` so an
 * oversized body is never buffered in full. Returns null when it is too large.
 */
async function readCappedBody(req: Request, maxBytes: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Extract the gas estimation from a `simulateTransaction` result. The Soroban
 * RPC reports resource usage under `cost` (CPU instructions + memory bytes)
 * and `result.footprint` (ledger read/write keys), with the estimated fee in
 * `minResourceFee`. Missing fields fall back to zero so the UI always has a
 * complete breakdown to render.
 */
function extractGasEstimate(result: unknown): GasEstimate | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const cost = (r.cost ?? {}) as Record<string, unknown>;
  const footprint = (r.footprint ?? {}) as Record<string, unknown>;
  const readOnly = Array.isArray(footprint.readOnly) ? footprint.readOnly.length : 0;
  const readWrite = Array.isArray(footprint.readWrite) ? footprint.readWrite.length : 0;
  const fee = typeof r.minResourceFee === "string" ? r.minResourceFee : "0";
  return {
    cpuInstructions: Number(cost.cpuInsns ?? 0),
    memoryBytes: Number(cost.memBytes ?? 0),
    ledgerReads: readOnly,
    ledgerWrites: readWrite,
    fee,
  };
}

export async function POST(req: Request, { params }: Params) {
  const limited = rateLimitRequest(req, { scope: "contract-simulate", max: 10 });
  if (limited) return limited;

  const raw = await readCappedBody(req, MAX_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }

  let body: SimulateBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.functionName) {
    return NextResponse.json({ error: "Missing required field: functionName" }, { status: 400 });
  }

  const args = body.args ?? [];
  if (!Array.isArray(args)) {
    return NextResponse.json({ error: "args must be an array" }, { status: 400 });
  }

  // Only check the count when the contract's spec declares the function; without
  // a spec (no WASM, or an RPC failure) the simulation itself decides.
  const wasm = body.types ? null : await getContractWasmInfo(params.id);
  const declared = wasm?.functions.find((f) => f.name === body.functionName);
  if (declared && args.length > declared.inputs.length) {
    return NextResponse.json(
      {
        success: false,
        error: `${declared.name} takes ${declared.inputs.length} argument(s), but ${args.length} were given`,
      },
      { status: 400 }
    );
  }

  try {
    const scArgs = args.map((a) => coerceArgInput(a.value, a.type, body.types ?? wasm?.types ?? []));
    const result = await simulateInvocation(params.id, body.functionName, scArgs);
    const gas = extractGasEstimate(result);
    return NextResponse.json(gas ? { ...result, gas } : result);
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Invalid arguments" },
      { status: 400 }
    );
  }
}
