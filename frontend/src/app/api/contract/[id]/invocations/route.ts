import { NextResponse } from "next/server";
import { getInvocationHistoryPage } from "@/lib/soroban";
import { parsePageRequest } from "@/lib/history-cursor";
import { INVOCATION_PAGE_SIZE } from "@/lib/contract-lists";
import { rateLimitRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

const DEFAULT_RATE_LIMIT_MAX_ENTRIES = 10_000;

function resolveRateLimitMaxEntries(): number {
  const raw = process.env.RATE_LIMIT_MAX_ENTRIES?.trim();
  if (!raw) {
    return DEFAULT_RATE_LIMIT_MAX_ENTRIES;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RATE_LIMIT_MAX_ENTRIES;
  }

  return parsed;
}

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

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value) ?? String(value);
  const safeText = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safeText) ? `"${safeText.replace(/"/g, '""')}"` : safeText;
}

export async function GET(req: Request, { params }: Params) {
  const cors = corsHeaders(req);

  const limited = rateLimitRequest(req, {
    scope: "contract-invocations",
    maxEntries: resolveRateLimitMaxEntries(),
  });
  if (limited) {
    for (const [key, value] of Object.entries(cors)) {
      limited.headers.set(key, value);
    }
    return limited;
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format");

  if (format === "csv") {
    const request = parsePageRequest(url, INVOCATION_PAGE_SIZE);
    if (!request) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400, headers: cors });
    }

    const { items } = await getInvocationHistoryPage(params.id, request);
    const header = ["ledger", "timestamp", "txHash", "function", "args", "successful"];
    const rows = items.map((invocation) =>
      [
        invocation.ledger,
        invocation.timestamp,
        invocation.txHash,
        invocation.functionName ?? "",
        invocation.args ?? [],
        invocation.successful,
      ]
        .map(csvCell)
        .join(",")
    );
    const csv = [header.join(","), ...rows].join("\n");
    const fileId = params.id.replace(/[^A-Za-z0-9_-]/g, "_");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="invocations-${fileId}.csv"`,
        ...cors,
      },
    });
  }

  const request = parsePageRequest(url, INVOCATION_PAGE_SIZE);
  if (!request) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400, headers: cors });
  }

  const { items, nextCursor } = await getInvocationHistoryPage(params.id, request);
  return NextResponse.json({ invocations: items, nextCursor }, { headers: cors });
}
