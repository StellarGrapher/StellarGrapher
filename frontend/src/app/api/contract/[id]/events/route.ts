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

  const limited = rateLimitRequest(req, { scope: "contract-events" });
  if (limited) {
    for (const [key, value] of Object.entries(cors)) limited.headers.set(key, value);
    return limited;
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format");

  if (format === "csv") {
    const request = parsePageRequest(url, EVENT_PAGE_SIZE);
    if (!request) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400, headers: cors });
    }

    const { items, error } = await getContractEventsPage(params.id, request);
    if (error) {
      return NextResponse.json(
        { events: [], nextCursor: null, error },
        { status: 502, headers: cors }
      );
    }

    const header = ["ledger", "timestamp", "type", "topic", "value", "txHash"];
    const rows = items.map((event) =>
      [event.ledger, event.timestamp, event.type, event.topic, event.value, event.txHash]
        .map(csvCell)
        .join(",")
    );
    const csv = [header.join(","), ...rows].join("\n");
    const fileId = params.id.replace(/[^A-Za-z0-9_-]/g, "_");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="contract-${fileId}-events.csv"`,
        ...cors,
      },
    });
  }

  const request = parsePageRequest(url, EVENT_PAGE_SIZE);
  if (!request) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400, headers: cors });
  }

  const { items, nextCursor, error } = await getContractEventsPage(params.id, request);
  if (error) {
    return NextResponse.json({ events: [], nextCursor: null, error }, { status: 502, headers: cors });
  }
  return NextResponse.json({ events: items, nextCursor, error: null }, { headers: cors });
}
