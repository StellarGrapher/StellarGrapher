import { NextResponse } from "next/server";
import { getContractInfo, getContractWasmInfo, isRpcUnreachableError } from "@/lib/soroban";
import { getIndexedGaps } from "@/lib/indexed-db";
import { rateLimitRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

function resolveAllowedOrigin(req: Request): string | null {
  const configured = process.env.CORS_ALLOWED_ORIGINS;
  const origin = req.headers.get("origin");

  // Default to "*" in dev; in prod require an explicit allowlist.
  const allowList = (configured ?? (process.env.NODE_ENV === "production" ? "" : "*"))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (allowList.includes("*")) return "*";
  if (origin && allowList.includes(origin)) return origin;
  return null;
}

function withCors(req: Request, res: NextResponse): NextResponse {
  const allowedOrigin = resolveAllowedOrigin(req);
  if (allowedOrigin) {
    res.headers.set("Access-Control-Allow-Origin", allowedOrigin);
    if (allowedOrigin !== "*") res.headers.append("Vary", "Origin");
  }
  // Credentials are not allowed by default.
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res;
}

export async function OPTIONS(req: Request) {
  return withCors(req, new NextResponse(null, { status: 204 }));
}

interface ResourceLimits {
  cpuInsns: number | null;
  memBytes: number | null;
  ledgerReadBytes: number | null;
  ledgerWriteBytes: number | null;
  ledgerReadEntries: number | null;
  ledgerWriteEntries: number | null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractResourceLimits(entry: unknown): ResourceLimits | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const contractData = record.contractData as Record<string, unknown> | undefined;
  const val = (contractData?.val ?? record.val) as Record<string, unknown> | undefined;
  const executable = val?.executable as Record<string, unknown> | undefined;
  const wasm = executable?.wasm as Record<string, unknown> | undefined;
  const limits = (wasm?.limits ?? val?.limits ?? record.limits) as Record<string, unknown> | undefined;
  if (!limits) return null;
  return {
    cpuInsns: toNumber(limits.cpuInsns ?? limits.cpu_insns),
    memBytes: toNumber(limits.memBytes ?? limits.mem_bytes),
    ledgerReadBytes: toNumber(limits.ledgerReadBytes ?? limits.ledger_read_bytes),
    ledgerWriteBytes: toNumber(limits.ledgerWriteBytes ?? limits.ledger_write_bytes),
    ledgerReadEntries: toNumber(limits.ledgerReadEntries ?? limits.ledger_read_entries),
    ledgerWriteEntries: toNumber(limits.ledgerWriteEntries ?? limits.ledger_write_entries),
  };
}

function extractWasmSize(entry: unknown): number | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const contractData = record.contractData as Record<string, unknown> | undefined;
  const val = (contractData?.val ?? record.val) as Record<string, unknown> | undefined;
  const executable = val?.executable as Record<string, unknown> | undefined;
  const wasm = executable?.wasm as Record<string, unknown> | undefined;
  const code = wasm?.code as unknown;
  if (typeof code === "string") {
    // Soroban returns the WASM code as a base64-encoded string.
    try {
      return Buffer.from(code, "base64").byteLength;
    } catch {
      return null;
    }
  }
  if (Array.isArray(code)) return code.length;
  return toNumber(wasm?.size ?? wasm?.byteLength);
}

function extractExpirationLedger(entry: unknown): number | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const contractData = record.contractData as Record<string, unknown> | undefined;
  const val = (contractData?.val ?? record.val) as Record<string, unknown> | undefined;
  const executable = val?.executable as Record<string, unknown> | undefined;
  const wasm = executable?.wasm as Record<string, unknown> | undefined;
  return toNumber(
    record.liveUntilLedgerSeq ??
      record.liveUntilLedger ??
      record.expirationLedger ??
      record.expirationLedgerSeq ??
      contractData?.liveUntilLedgerSeq ??
      val?.liveUntilLedgerSeq ??
      wasm?.liveUntilLedgerSeq,
  );
}

export async function GET(req: Request, { params }: Params) {
  const limited = rateLimitRequest(req, { scope: "contract-info" });
  if (limited) return withCors(req, limited);

  let info: Awaited<ReturnType<typeof getContractInfo>>;
  let historyGaps: Awaited<ReturnType<typeof getIndexedGaps>>;
  try {
    [info, historyGaps] = await Promise.all([getContractInfo(params.id), getIndexedGaps()]);
  } catch (err) {
    if (isRpcUnreachableError(err)) {
      return withCors(
        req,
        NextResponse.json(
          {
            error: "RPC unreachable",
            code: "RPC_UNREACHABLE",
            rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? null,
            docsUrl: "https://github.com/prism-explorer/prism#self-hosting",
          },
          { status: 502 }
        )
      );
    }
    throw err;
  }

  if (!info) {
    return withCors(
      req,
      NextResponse.json(
        {
          error: "Contract not found or unreachable",
          code: "CONTRACT_NOT_FOUND",
          rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? null,
          docsUrl: "https://github.com/prism-explorer/prism#self-hosting",
        },
        { status: 404 }
      )
    );
  }
  const wasm = info.executable === "wasm" ? await getContractWasmInfo(params.id) : null;

  // Use the fetched WASM for its size and parse any resource metadata exposed by RPC.
  const ledgerEntries = "ledgerEntries" in info ? info.ledgerEntries : undefined;
  const entries = Array.isArray(ledgerEntries) ? ledgerEntries : [];
  let wasmSize: number | null = wasm?.size ?? null;
  let resourceLimits: ResourceLimits | null = null;
  let expirationLedger: number | null = info.liveUntilLedgerSeq ?? null;
  for (const entry of entries) {
    if (wasmSize === null) wasmSize = extractWasmSize(entry);
    if (resourceLimits === null) resourceLimits = extractResourceLimits(entry);
    if (expirationLedger === null) expirationLedger = extractExpirationLedger(entry);
    if (wasmSize !== null && resourceLimits !== null && expirationLedger !== null) break;
  }

  // Gaps are ledger ranges the indexer skipped for every contract; the UI can flag them.
  return withCors(
    req,
    NextResponse.json({ ...info, historyGaps, wasmSize, resourceLimits, expirationLedger })
  );
}
