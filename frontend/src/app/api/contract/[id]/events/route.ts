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

const SORT_KEYS = ["ledger", "timestamp", "topic"] as const;
type SortKey = (typeof SORT_KEYS)[number];
type SortDir = "asc" | "desc";

function isSortKey(value: string): value is SortKey {
  return SORT_KEYS.some((key) => key === value);
}

function parseSort(url: URL): { sort: SortKey; dir: SortDir } | null {
  const rawSort = url.searchParams.get("sort");
  const rawDir = url.searchParams.get("dir");
  if (rawSort === null && rawDir === null) return null;
  if (!rawSort || !isSortKey(rawSort)) return null;
  if (rawDir !== null && rawDir !== "asc" && rawDir !== "desc") return null;
  return { sort: rawSort, dir: rawDir ?? "desc" };
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

  const sort = parseSort(url);
  if (url.searchParams.has("sort") && !sort) {
    return NextResponse.json({ error: "Invalid sort" }, { status: 400, headers: cors });
  }
  if (url.searchParams.has("dir") && !sort) {
    return NextResponse.json({ error: "Invalid sort direction" }, { status: 400, headers: cors });
  }

  const { items, nextCursor, error } = await getContractEventsPage(params.id, request);

  if (error) {
    return NextResponse.json(
      { events: items, nextCursor, error },
      { status: 502, headers: cors }
    );
  }
  const events = sort ? sortEvents(items, sort.sort, sort.dir) : items;
  return NextResponse.json({ events, nextCursor, error: null }, { headers: cors });
}

function sortEvents(
  items: Awaited<ReturnType<typeof getContractEventsPage>>["items"],
  sort: SortKey,
  dir: SortDir,
): typeof items {
  const factor = dir === "asc" ? 1 : -1;
  const value = (item: (typeof items)[number]): number | string => {
    if (sort === "ledger") return item.ledger ?? 0;
    if (sort === "timestamp") return item.timestamp ?? 0;
    return item.topic[0] ?? "";
  };
  return [...items].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
    return String(av).localeCompare(String(bv)) * factor;
  });
}
