import { NextResponse } from "next/server";
import { getContractInfo } from "@/lib/soroban";
import { getIndexedGaps } from "@/lib/indexed-db";
import { rateLimitRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

function isRpcUnreachable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network|socket hang up|timeout|unreachable/i.test(
    message,
  );
}

export async function GET(req: Request, { params }: Params) {
  const limited = rateLimitRequest(req, { scope: "contract-info" });
  if (limited) return limited;

  let info: Awaited<ReturnType<typeof getContractInfo>>;
  let historyGaps: Awaited<ReturnType<typeof getIndexedGaps>>;
  try {
    [info, historyGaps] = await Promise.all([getContractInfo(params.id), getIndexedGaps()]);
  } catch (err) {
    if (isRpcUnreachable(err)) {
      return NextResponse.json(
        {
          error: "RPC unreachable",
          code: "RPC_UNREACHABLE",
          rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? null,
          docsUrl: "https://github.com/Handsoff/soroban-explorer#self-hosting",
        },
        { status: 502 },
      );
    }
    throw err;
  }

  if (!info) {
    return NextResponse.json(
      {
        error: "Contract not found",
        code: "CONTRACT_NOT_FOUND",
        rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? null,
        docsUrl: "https://github.com/Handsoff/soroban-explorer#self-hosting",
      },
      { status: 404 },
    );
  }
  // Gaps are ledger ranges the indexer skipped for every contract; the UI can flag them.
  return NextResponse.json({ ...info, historyGaps });
}
