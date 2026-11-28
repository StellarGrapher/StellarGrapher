"use client";

import { useState } from "react";
import ExpandableValue from "./ExpandableValue";
import StorageLookup from "./StorageLookup";
import { lookupStorageKeyAction } from "@/lib/actions";
import type { StorageKeyKind } from "@/lib/soroban";
import type { StorageEntry } from "@/types";

interface Props { contractId: string; instanceStorage: StorageEntry[]; fullStorage?: StorageEntry[] }

export default function ContractStorageView({ contractId, instanceStorage, fullStorage }: Props) {
  const hasFullStorage = fullStorage !== undefined && fullStorage.length > 0;
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<StorageEntry | { error: string } | null>(null);

  return (
    <div>
      {hasFullStorage ? (
        <div>
          <p className="text-xs text-prism-muted mb-2">
            Full storage indexed since the indexer started — {fullStorage!.length} keys observed
            (persistent/temporary/instance). Not full chain history, just everything touched since launch.
          </p>
          <div className="rounded-xl border border-prism-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-prism-surface border-b border-prism-border">
                <tr>
                  <th className="text-left px-4 py-3 text-prism-muted font-medium">Durability</th>
                  <th className="text-left px-4 py-3 text-prism-muted font-medium">Key</th>
                  <th className="text-left px-4 py-3 text-prism-muted font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {fullStorage!.map((e, i) => (
                  <tr key={i} className="border-b border-prism-border last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-prism-accent">{e.durability}</td>
                    <td className="px-4 py-3 font-mono text-xs">{e.key}</td>
                    <td className="px-4 py-3 font-mono text-xs text-prism-muted"><ExpandableValue value={e.value} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : instanceStorage.length === 0 ? (
        <EmptyState>No instance storage entries found for this contract.</EmptyState>
      ) : (
        <div className="rounded-xl border border-prism-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-prism-surface border-b border-prism-border">
              <tr>
                <th className="text-left px-4 py-3 text-prism-muted font-medium">Key</th>
                <th className="text-left px-4 py-3 text-prism-muted font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {instanceStorage.map((e, i) => (
                <tr key={i} className="border-b border-prism-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{e.key}</td>
                  <td className="px-4 py-3 font-mono text-xs text-prism-muted"><ExpandableValue value={e.value} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <StorageLookup contractId={contractId} />
      <div className="mt-4 rounded-xl border border-prism-border bg-prism-surface p-4" data-testid="storage-lookup">
        <p className="text-sm text-prism-muted mb-3">
          Look up a single persistent or temporary entry by key. Soroban RPC can&apos;t enumerate a
          contract&apos;s storage, so the key has to be known in advance.
        </p>
        <form
          className="flex flex-wrap gap-2 items-start"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const kind = (form.elements.namedItem("kind") as HTMLSelectElement).value as StorageKeyKind;
            const durability = (form.elements.namedItem("durability") as HTMLSelectElement).value as
              | "persistent"
              | "temporary";
            const rawKey = (form.elements.namedItem("key") as HTMLInputElement).value;
            setPending(true);
            setResult(null);
            try {
              setResult(await lookupStorageKeyAction(contractId, kind, rawKey, durability));
            } finally {
              setPending(false);
            }
          }}
        >
          <select
            name="kind"
            defaultValue="symbol"
            aria-label="Storage key type"
            className="bg-prism-bg border border-prism-border rounded-lg px-2 py-2 text-xs font-mono outline-none focus:border-prism-accent"
          >
            <option value="symbol">Symbol</option>
            <option value="string">String</option>
            <option value="u32">U32</option>
            <option value="address">Address</option>
          </select>
          <select
            name="durability"
            defaultValue="persistent"
            aria-label="Storage durability"
            className="bg-prism-bg border border-prism-border rounded-lg px-2 py-2 text-xs font-mono outline-none focus:border-prism-accent"
          >
            <option value="persistent">Persistent</option>
            <option value="temporary">Temporary</option>
          </select>
          <input
            name="key"
            placeholder="key"
            aria-label="Storage key"
            className="flex-1 min-w-[160px] bg-prism-bg border border-prism-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-prism-accent"
          />
          <button
            type="submit"
            disabled={pending}
            className="bg-prism-accent text-white px-4 py-2 rounded-lg text-xs font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {pending ? "Looking up…" : "Look up"}
          </button>
        </form>
        {result && (
          <div className="mt-3 text-xs font-mono" data-testid="storage-lookup-result">
            {"error" in result ? (
              <p className="text-prism-red">{result.error}</p>
            ) : (
              <div className="rounded-lg border border-prism-border p-3 space-y-1">
                <p>
                  <span className="text-prism-muted">Key:</span> {result.key}
                </p>
                <p className="break-all">
                  <span className="text-prism-muted">Value:</span> {result.value}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
