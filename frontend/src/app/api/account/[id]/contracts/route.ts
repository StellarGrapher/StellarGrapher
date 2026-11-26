import { NextResponse } from "next/server";
import { getIndexedAccountContracts } from "@/lib/indexed-db";
import { parsePageRequest } from "@/lib/history-cursor";
import { ACCOUNT_CONTRACT_PAGE_SIZE } from "@/lib/contract-lists";
import { rateLimitRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

export async function GET(req: Request, { params }: Params) {
  const limited = rateLimitRequest(req, { scope: "account-contracts" });
  if (limited) return limited;

  const request = parsePageRequest(new URL(req.url), ACCOUNT_CONTRACT_PAGE_SIZE);
  if (!request) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });

  const { items, nextCursor } = await getIndexedAccountContracts(params.id, request);
  return NextResponse.json({ contracts: items, nextCursor });
}
