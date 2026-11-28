import { NextResponse } from "next/server";
import { getFullStorageEntries } from "@/lib/soroban";
import { isIndexerConfigured } from "@/lib/indexed-db";
import { rateLimitRequest } from "@/lib/rate-limit";
import { isValidContractId } from "@/lib/route-params";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

export async function GET(req: Request, { params }: Params) {
  const limited = rateLimitRequest(req, { scope: "contract-storage-full" });
  if (limited) return limited;

  if (!isValidContractId(params.id)) {
    return NextResponse.json({ error: "Invalid contract ID format" }, { status: 400 });
  }

  if (!isIndexerConfigured()) {
    return NextResponse.json(
      { error: "No indexer configured for this deployment — full storage enumeration isn't available." },
      { status: 501 }
    );
  }

  const entries = await getFullStorageEntries(params.id);
  return NextResponse.json({ entries });
}
