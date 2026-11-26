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
import Breadcrumb from "@/components/Breadcrumb";
import { EVENT_PAGE_SIZE, INVOCATION_PAGE_SIZE } from "@/lib/contract-lists";

export const dynamic = "force-dynamic";

interface Props { params: { id: string } }

// Security (#123): all dynamic XDR-derived values on this page are rendered
// through React's safe text rendering path (JSX text nodes / props), never via
// dangerouslySetInnerHTML. This page contains no dangerouslySetInnerHTML usage.

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

const TTL_DOCS_URL = "https://developers.stellar.org/docs/learn/smart-contract-internals/state-archival";

function TtlBadge({ ttl }: { ttl: number | null | undefined }) {
  if (ttl == null) return null;
  if (ttl < 100) {
    return (
      <span className="shrink-0 rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white">
        Critical: expires in {ttl.toLocaleString()} ledgers
      </span>
    );
  }
  if (ttl < 1000) {
    return (
      <span className="shrink-0 rounded bg-orange-500 px-2 py-1 text-xs font-semibold text-white">
        Warning: expires in {ttl.toLocaleString()} ledgers
      </span>
    );
  }
  return null;
}

export default async function ContractPage({ params }: Props) {
  const contractId = params.id;
  const info = await getContractInfo(contractId);
  const [wasm, eventsPage, invocationsPage, fullStorage] = await Promise.all([
    info?.executable === "wasm" ? getContractWasmInfo(contractId) : Promise.resolve(null),
    getContractEventsPage(contractId, { limit: EVENT_PAGE_SIZE }),
    getInvocationHistoryPage(contractId, { limit: INVOCATION_PAGE_SIZE }),
    getFullStorageEntries(contractId),
  ]);

  const rpcFallback = !isIndexerConfigured();
  const storageCount = fullStorage.length > 0 ? fullStorage.length : (info?.instanceStorage ?? []).length;

  const wasmSizeKb = wasm?.size != null ? wasm.size / 1024 : null;

  const expirationLedger = info?.liveUntilLedgerSeq ?? null;
  const ttl = info?.ttl ?? null;

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "Contracts", href: "/contracts" },
          { label: contractId },
        ]}
      />
      <h1 className="text-2xl font-bold mb-1">Contract</h1>
      <div className="flex items-start gap-2 mb-8">
        <p className="text-prism-muted font-mono text-sm break-all">{contractId}</p>
        <CopyButton value={contractId} what="contract ID" />
        {wasmSizeKb != null && (
          <span className="ml-auto shrink-0 rounded bg-prism-surface px-2 py-1 text-xs font-mono text-prism-muted">
            WASM: {wasmSizeKb.toFixed(2)} KB
          </span>
        )}
      </div>

      <div className="mb-8 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-prism-muted">Expiration ledger:</span>
        <span className="font-mono">
          {expirationLedger != null ? expirationLedger.toLocaleString() : "—"}
        </span>
        <TtlBadge ttl={ttl} />
        <a
          href={TTL_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-prism-accent underline hover:no-underline"
        >
          Extend TTL
        </a>
      </div>

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
            stickyHeader
            exportCsv
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
            stickyHeader
            exportCsv
          />
        </section>
      </div>
    </div>
  );
}
