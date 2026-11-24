import { NextResponse } from "next/server";
import { getContractEventsPage } from "@/lib/soroban";
import { parsePageRequest } from "@/lib/history-cursor";
import { EVENT_PAGE_SIZE } from "@/lib/contract-lists";
import { rateLimitRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

const SORT_KEYS = ["ledger", "timestamp", "topic"] as const;
type SortKey = (typeof SORT_KEYS)[number];
type SortDir = "asc" | "desc";

function parseSort(url: URL): { sort: SortKey; dir: SortDir } | null {
  const rawSort = url.searchParams.get("sort");
  const rawDir = url.searchParams.get("dir");
  if (rawSort === null && rawDir === null) return null;
  if (!rawSort || !SORT_KEYS.includes(rawSort as SortKey)) return null;
  if (rawDir !== null && rawDir !== "asc" && rawDir !== "desc") return null;
  return { sort: rawSort as SortKey, dir: (rawDir as SortDir) ?? "desc" };
}

export async function GET(req: Request, { params }: Params) {
  const limited = rateLimitRequest(req, { scope: "contract-events" });
  if (limited) return limited;

  const url = new URL(req.url);
  const request = parsePageRequest(url, EVENT_PAGE_SIZE);
  if (!request) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });

  const sort = parseSort(url);
  if (url.searchParams.has("sort") && !sort) {
    return NextResponse.json({ error: "Invalid sort" }, { status: 400 });
  }

  const { items, nextCursor, error } = await getContractEventsPage(params.id, request);
  if (error) {
    return NextResponse.json({ events: [], nextCursor: null, error }, { status: 502 });
  }

  const events = sort ? sortEvents(items, sort.sort, sort.dir) : items;
  return NextResponse.json({ events, nextCursor, error: null });
}

function sortEvents<T extends { ledger?: number; timestamp?: number; topics?: unknown[] }>(
  items: T[],
  sort: SortKey,
  dir: SortDir,
): T[] {
  const factor = dir === "asc" ? 1 : -1;
  const value = (item: T): number | string => {
    if (sort === "ledger") return item.ledger ?? 0;
    if (sort === "timestamp") return item.timestamp ?? 0;
    const topic = Array.isArray(item.topics) ? item.topics[0] : undefined;
    return typeof topic === "string" ? topic : String(topic ?? "");
  };
  return [...items].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
    return String(av).localeCompare(String(bv)) * factor;
  });
}
