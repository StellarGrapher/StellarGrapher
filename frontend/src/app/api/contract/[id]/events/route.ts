import { NextResponse } from "next/server";
import { getContractEventsPage } from "@/lib/soroban";
import { parsePageRequest } from "@/lib/history-cursor";
import { EVENT_PAGE_SIZE } from "@/lib/contract-lists";
import { rateLimitRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(events: Array<Record<string, unknown>>): string {
  const header = ["ledger", "timestamp", "contract", "topics", "data"];
  const rows = events.map((event) =>
    [
      event.ledger,
      event.timestamp,
      event.contract,
      Array.isArray(event.topics) ? event.topics.join(" ") : event.topics,
      event.data,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\r\n");
}

export async function GET(req: Request, { params }: Params) {
  const limited = rateLimitRequest(req, { scope: "contract-events" });
  if (limited) return limited;

  const url = new URL(req.url);
  const request = parsePageRequest(url, EVENT_PAGE_SIZE);
  if (!request) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });

  const { items, nextCursor, error } = await getContractEventsPage(params.id, request);

  if (url.searchParams.get("format") === "csv") {
    const csv = toCsv((items ?? []) as Array<Record<string, unknown>>);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="contract-${params.id}-events.csv"`,
      },
    });
  }

  if (error) {
    // Without the indexer we still return whatever page we could load so the
    // table can paginate; surface the error alongside the partial results.
    return NextResponse.json(
      { events: items ?? [], nextCursor: nextCursor ?? null, error },
      { status: 502 },
    );
  }
  return NextResponse.json({ events: items, nextCursor, error: null });
}
