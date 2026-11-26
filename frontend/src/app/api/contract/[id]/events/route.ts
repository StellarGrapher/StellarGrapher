import { NextResponse } from "next/server";
import { getContractEventsPage } from "@/lib/soroban";
import { parsePageRequest } from "@/lib/history-cursor";
import { EVENT_PAGE_SIZE } from "@/lib/contract-lists";
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
  const allowOrigin = resolveAllowedOrigin(req);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
  }
  return headers;
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request, { params }: Params) {
  const cors = corsHeaders(req);

  const limited = rateLimitRequest(req, { scope: "contract-events" });
  if (limited) {
    for (const [key, value] of Object.entries(cors)) limited.headers.set(key, value);
    return limited;
  }

  const request = parsePageRequest(new URL(req.url), EVENT_PAGE_SIZE);
  if (!request) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400, headers: cors });
  }

  const { items, nextCursor, error } = await getContractEventsPage(params.id, request);
  if (error) {
    return NextResponse.json({ events: [], nextCursor: null, error }, { status: 502, headers: cors });
  }
  return NextResponse.json({ events: items, nextCursor, error: null }, { headers: cors });
}
