"use client";

import Link from "next/link";
import { useEffect } from "react";

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL;
const SELF_HOSTING_DOCS = "https://github.com/prism-explorer/prism#self-hosting";

/**
 * Shown when a page fails for a reason that isn't "this record doesn't exist"
 * — Horizon or the RPC node being unreachable, a timeout, a 5xx. Those used to
 * surface as a 404, which told the reader something false about the chain.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const message = error.message ?? "";
  const isContractNotFound = /contract.*not found|not found.*contract/i.test(message);
  const isRpcUnreachable =
    !isContractNotFound &&
    /rpc|fetch failed|econnrefused|etimedout|network|unreachable|timeout/i.test(message);

  return (
    <div className="max-w-xl">
      {isContractNotFound ? (
        <>
          <h1 className="text-2xl font-bold mb-2">Contract not found</h1>
          <p className="text-prism-muted text-sm mb-6">
            The RPC node responded, but it doesn&apos;t know about this contract. Double-check the
            contract ID — it may not be deployed on the network you&apos;re querying.
          </p>
        </>
      ) : isRpcUnreachable ? (
        <>
          <h1 className="text-2xl font-bold mb-2">RPC node unreachable</h1>
          <p className="text-prism-muted text-sm mb-4">
            Prism couldn&apos;t reach the configured Soroban RPC endpoint. The node may be down,
            overloaded, or the URL may be misconfigured.
          </p>
          <div className="border border-prism-border rounded-lg p-3 mb-6">
            <p className="text-xs text-prism-muted mb-1">Configured RPC URL</p>
            <p className="text-xs font-mono break-all text-prism-strong">
              {RPC_URL || "NEXT_PUBLIC_SOROBAN_RPC_URL is not set"}
            </p>
          </div>
          <p className="text-prism-muted text-sm mb-6">
            Check that <span className="font-mono">NEXT_PUBLIC_SOROBAN_RPC_URL</span> points at a
            reachable node. See the{" "}
            <a
              href={SELF_HOSTING_DOCS}
              target="_blank"
              rel="noreferrer"
              className="text-prism-accent hover:underline"
            >
              self-hosting docs
            </a>{" "}
            for setup details.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold mb-2">Couldn&apos;t load this page</h1>
          <p className="text-prism-muted text-sm mb-6">
            Prism reached for data and didn&apos;t get it. That usually means the configured Horizon
            or Soroban RPC endpoint is unreachable, overloaded, or timing out — not that what you
            searched for is missing.
          </p>
        </>
      )}

      <div className="flex gap-2">
        <button
          onClick={reset}
          className="bg-prism-accent text-white px-4 py-2 rounded-lg text-xs font-medium hover:opacity-90 transition"
        >
          Try again
        </button>
        <Link
          href="/explorer"
          className="border border-prism-border px-4 py-2 rounded-lg text-xs font-medium text-prism-muted hover:text-prism-strong transition"
        >
          Back to the explorer
        </Link>
      </div>

      {error.digest && (
        <p className="text-xs text-prism-muted font-mono mt-6">Reference: {error.digest}</p>
      )}
    </div>
  );
}
