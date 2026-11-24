import { NextResponse } from "next/server";
import { getInvocationHistoryPage } from "@/lib/soroban";
import { parsePageRequest } from "@/lib/history-cursor";
import { INVOCATION_PAGE_SIZE } from "@/lib/contract-lists";
import { rateLimitRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

export async function GET(req: Request, { params }: Params) {
  const limited = rateLimitRequest(req, { scope: "contract-invocations" });
  if (limited) return limited;

  const request = parsePageRequest(new URL(req.url), INVOCATION_PAGE_SIZE);
  if (!request) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });

  try {
    const { items, nextCursor } = await getInvocationHistoryPage(params.id, request);
    return NextResponse.json({ invocations: items, nextCursor });
  } catch (err) {
    // Without the indexer running, the history source may be unavailable.
    // Return an empty page (no cursor) so the table degrades gracefully
    // instead of surfacing a hard error to the paginated UI.
    console.error("Failed to load invocation history page", err);
    return NextResponse.json({ invocations: [], nextCursor: null });
  }
}
