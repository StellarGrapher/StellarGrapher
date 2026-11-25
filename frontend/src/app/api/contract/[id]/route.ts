import { NextResponse } from "next/server";
import { getContractInfo } from "@/lib/soroban";
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

export async function GET(req: Request, { params }: Params) {
  const limited = rateLimitRequest(req, { scope: "contract-info" });
  if (limited) return withCors(req, limited);

  const [info, historyGaps] = await Promise.all([getContractInfo(params.id), getIndexedGaps()]);
  if (!info) {
    return withCors(
      req,
      NextResponse.json({ error: "Contract not found or unreachable" }, { status: 404 })
    );
  }
  // Gaps are ledger ranges the indexer skipped for every contract; the UI can flag them.
  return withCors(req, NextResponse.json({ ...info, historyGaps }));
}
