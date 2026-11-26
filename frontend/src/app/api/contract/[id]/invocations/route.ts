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

const SORTABLE_FIELDS = ["ledger", "timestamp", "function"] as const;
type SortField = (typeof SORTABLE_FIELDS)[number];
type SortDirection = "asc" | "desc";

function isSortField(value: string): value is SortField {
  return SORTABLE_FIELDS.some((field) => field === value);
}

function parseSort(url: URL): { field: SortField; direction: SortDirection } | null {
  const field = url.searchParams.get("sort");
  const direction = url.searchParams.get("dir");
  if (field === null && direction === null) return null;
  if (!field || !isSortField(field)) return null;
  if (direction !== null && direction !== "asc" && direction !== "desc") return null;
  return { field, direction: direction ?? "desc" };
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

  const sort = parseSort(url);
  if (url.searchParams.has("sort") && !sort) {
    return NextResponse.json({ error: "Invalid sort" }, { status: 400, headers: cors });
  }
  if (url.searchParams.has("dir") && !sort) {
    return NextResponse.json({ error: "Invalid sort direction" }, { status: 400, headers: cors });
  }
  const { items, nextCursor } = await getInvocationHistoryPage(params.id, request);

  const sorted = sort
    ? [...items].sort((a, b) => {
        const getValue = (item: (typeof items)[number]) => {
          if (sort.field === "function") return item.functionName ?? "";
          return sort.field === "ledger" ? item.ledger : item.timestamp;
        };
        const av = getValue(a);
        const bv = getValue(b);
        const comparison =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av).localeCompare(String(bv));
        return sort.direction === "asc" ? comparison : -comparison;
      })
    : items;

  return NextResponse.json({ invocations: sorted, nextCursor }, { headers: cors });
}
