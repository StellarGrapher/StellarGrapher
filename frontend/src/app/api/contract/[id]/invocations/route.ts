import { NextResponse } from "next/server";
import { getInvocationHistoryPage } from "@/lib/soroban";
import { parsePageRequest } from "@/lib/history-cursor";
import { INVOCATION_PAGE_SIZE } from "@/lib/contract-lists";
import { rateLimitRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

const SORTABLE_FIELDS = ["ledger", "timestamp", "function", "fee"] as const;
type SortField = (typeof SORTABLE_FIELDS)[number];
type SortDirection = "asc" | "desc";

function parseSort(url: URL): { field: SortField; direction: SortDirection } | null {
  const field = url.searchParams.get("sort");
  const direction = url.searchParams.get("dir");
  if (!field || !direction) return null;
  if (!SORTABLE_FIELDS.includes(field as SortField)) return null;
  if (direction !== "asc" && direction !== "desc") return null;
  return { field: field as SortField, direction };
}

export async function GET(req: Request, { params }: Params) {
  const limited = rateLimitRequest(req, { scope: "contract-invocations" });
  if (limited) return limited;

  const url = new URL(req.url);
  const request = parsePageRequest(url, INVOCATION_PAGE_SIZE);
  if (!request) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });

  const sort = parseSort(url);
  const { items, nextCursor } = await getInvocationHistoryPage(params.id, request);

  // Server-side sorting for paginated results: sort the current page by the
  // requested column so the client can request a stable, ordered slice.
  const sorted = sort
    ? [...items].sort((a, b) => {
        const av = a[sort.field];
        const bv = b[sort.field];
        let cmp: number;
        if (typeof av === "number" && typeof bv === "number") {
          cmp = av - bv;
        } else {
          cmp = String(av ?? "").localeCompare(String(bv ?? ""));
        }
        return sort.direction === "asc" ? cmp : -cmp;
      })
    : items;

  return NextResponse.json({ invocations: sorted, nextCursor });
}
