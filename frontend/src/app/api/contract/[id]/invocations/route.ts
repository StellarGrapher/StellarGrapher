import { NextResponse } from "next/server";
import { getInvocationHistoryPage } from "@/lib/soroban";
import { parsePageRequest } from "@/lib/history-cursor";
import { INVOCATION_PAGE_SIZE } from "@/lib/contract-lists";
import { rateLimitRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

function resolveAllowedOrigin(req: Request): string | null {
  const configured = process.env.CORS_ALLOWED_ORIGINS?.trim();
  const origin = req.headers.get("origin");

  if (!configured || configured === "*") {
    return "*";
  }

  const allowed = configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (origin && allowed.includes(origin)) {
    return origin;
  }

  return null;
}

function corsHeaders(req: Request): Record<string, string> {
  const allowedOrigin = resolveAllowedOrigin(req);
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
  };

  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
  }

  return headers;
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request, { params }: Params) {
  const cors = corsHeaders(req);

  const limited = rateLimitRequest(req, { scope: "contract-invocations" });
  if (limited) {
    for (const [key, value] of Object.entries(cors)) {
      limited.headers.set(key, value);
    }
    return limited;
  }

  const request = parsePageRequest(new URL(req.url), INVOCATION_PAGE_SIZE);
  if (!request) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400, headers: cors });
  }

  const { items, nextCursor } = await getInvocationHistoryPage(params.id, request);
  return NextResponse.json({ invocations: items, nextCursor }, { headers: cors });
}
