import type { Metadata } from "next";
import { getContractInfo, getContractWasmInfo, getContractEventsPage, getInvocationHistoryPage, getFullStorageEntries } from "@/lib/soroban";
import { isIndexerConfigured } from "@/lib/indexed-db";
import ContractOverview from "@/components/ContractOverview";
import ContractStorageView from "@/components/ContractStorageView";
import LiveInvocationHistory from "@/components/LiveInvocationHistory";
import InvokeTool from "@/components/InvokeTool";
import LiveEventLog from "@/components/LiveEventLog";
import CopyButton from "@/components/CopyButton";
import SectionHeader from "@/components/SectionHeader";
import { EVENT_PAGE_SIZE, INVOCATION_PAGE_SIZE } from "@/lib/contract-lists";

export const dynamic = "force-dynamic";

interface Props { params: { id: string } }

const SELF_HOSTING_DOCS_URL = "https://github.com/prism/soroban-explorer#self-hosting";

function isRpcUnreachableError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network|unreachable|timeout|socket hang up/i.test(message);
}

function RpcErrorCard({ rpcUrl, kind }: { rpcUrl: string; kind: "unreachable" | "not-found" }) {
  const isUnreachable = kind === "unreachable";
  return (
    <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-6">
      <h2 className="text-lg font-semibold text-red-400 mb-2">
        {isUnreachable ? "RPC node unreachable" : "Contract not found"}
      </h2>
      <p className="text-sm text-prism-muted mb-4">
        {isUnreachable
          ? "The explorer could not reach the configured Soroban RPC endpoint. The node may be down, misconfigured, or blocked by the network."
          : "The RPC node responded, but no contract exists at this address. Double-check the contract ID."}
      </p>
      <div className="mb-4">
        <p className="text-xs uppercase tracking-wide text-prism-muted mb-1">Configured RPC URL</p>
        <code className="block break-all rounded bg-black/30 px-3 py-2 font-mono text-xs text-prism-text">
          {rpcUrl || "(NEXT_PUBLIC_SOROBAN_RPC_URL is not set)"}
        </code>
      </div>
      {isUnreachable && (
        <p className="text-sm text-prism-muted mb-4">
          Verify the <code className="font-mono">NEXT_PUBLIC_SOROBAN_RPC_URL</code> environment variable points to a reachable node, then reload.
        </p>
      )}
      <a
        href={SELF_HOSTING_DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-sm font-medium text-prism-accent hover:underline"
      >
        Read the self-hosting docs →
      </a>
    </div>
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const contractId = params.id;
  const info = await getContractInfo(contractId);
  const title = `Contract ${contractId}`;
  const description = info
    ? `Contract ${contractId} on Stellar Soroban — executable: ${info.executable}.`
    : `Contract ${contractId} on Stellar Soroban.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { title, description },
  };
}

export default async function ContractPage({ params }: Props) {
  const contractId = params.id;
  const rpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "";

  let info: Awaited<ReturnType<typeof getContractInfo>> = null;
  let rpcError: unknown = null;
  try {
    info = await getContractInfo(contractId);
  } catch (error) {
    rpcError = error;
  }

  if (rpcError) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-1">Contract</h1>
        <div className="flex items-start gap-2 mb-8">
          <p className="text-prism-muted font-mono text-sm break-all">{contractId}</p>
          <CopyButton value={contractId} what="contract ID" />
        </div>
        <RpcErrorCard rpcUrl={rpcUrl} kind={isRpcUnreachableError(rpcError) ? "unreachable" : "not-found"} />
      </div>
    );
  }

  const [wasm, eventsPage, invocationsPage, fullStorage] = await Promise.all([
    info?.executable === "wasm" ? getContractWasmInfo(contractId) : Promise.resolve(null),
    getContractEventsPage(contractId, { limit: EVENT_PAGE_SIZE }),
    getInvocationHistoryPage(contractId, { limit: INVOCATION_PAGE_SIZE }),
    getFullStorageEntries(contractId),
  ]);

  const rpcFallback = !isIndexerConfigured();
  const storageCount = fullStorage.length > 0 ? fullStorage.length : (info?.instanceStorage ?? []).length;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Contract</h1>
      <div className="flex items-start gap-2 mb-8">
        <p className="text-prism-muted font-mono text-sm break-all">{contractId}</p>
        <CopyButton value={contractId} what="contract ID" />
      </div>

      {!info && (
        <div className="mb-8">
          <RpcErrorCard rpcUrl={rpcUrl} kind="not-found" />
        </div>
      )}

      <div className="grid grid-cols-1 gap-8">
        <section>
          <h2 className="text-lg font-semibold mb-3">Overview</h2>
          <ContractOverview info={info} wasm={wasm} />
        </section>

        {wasm && wasm.functions.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3">Invoke (simulate)</h2>
            <InvokeTool contractId={contractId} functions={wasm.functions} types={wasm.types} />
          </section>
        )}

        <section>
          <SectionHeader
            title="Storage"
            count={storageCount}
          />
          <ContractStorageView
            contractId={contractId}
            instanceStorage={info?.instanceStorage ?? []}
            fullStorage={fullStorage}
          />
        </section>

        <section>
          <LiveInvocationHistory
            contractId={contractId}
            initialItems={invocationsPage.items}
            initialNextCursor={invocationsPage.nextCursor}
            limit={INVOCATION_PAGE_SIZE}
            derivedFromEvents={rpcFallback}
            title="Recent Invocations"
          />
        </section>

        <section>
          <LiveEventLog
            contractId={contractId}
            initialEvents={eventsPage.items}
            initialNextCursor={eventsPage.nextCursor}
            initialError={eventsPage.error}
            limit={EVENT_PAGE_SIZE}
            rpcFallback={rpcFallback}
            specs={wasm?.events}
            title="Events"
            sortableColumns={["ledger", "timestamp", "topic"]}
          />
        </section>
      </div>
    </div>
  );
}
