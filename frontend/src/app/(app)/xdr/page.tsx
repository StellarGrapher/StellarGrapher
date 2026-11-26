import type { Metadata } from "next";
import XdrDecoder from "@/components/XdrDecoder";
import { decodeXdrAction } from "@/lib/actions";
import { base64FromQueryParam } from "@/lib/xdr";

export const metadata: Metadata = {
  title: "XDR Decoder | Prism",
  description:
    "Decode raw base64 Stellar/Soroban XDR — transaction envelopes, results, meta, ledger entries and keys, contract spec entries, and ScVals.",
};

const DEFAULT_MAX_XDR_INPUT_BYTES = 1024 * 1024;

function maxXdrInputBytes(): number {
  const raw = process.env.XDR_MAX_INPUT_BYTES;
  if (!raw) return DEFAULT_MAX_XDR_INPUT_BYTES;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_XDR_INPUT_BYTES;
}

interface Props {
  searchParams: { input?: string };
}

// Security: decoded XDR values (including ScString) are untrusted input and must
// never be rendered as HTML. This page intentionally renders all dynamic values
// through React's safe JSX text path and does not use `dangerouslySetInnerHTML`.
// If raw HTML rendering is ever required, sanitize with DOMPurify first.
export default async function XdrPage({ searchParams }: Props) {
  const input = searchParams.input ? base64FromQueryParam(searchParams.input) : undefined;

  if (input && Buffer.byteLength(input, "utf8") > maxXdrInputBytes()) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-1">XDR Decoder</h1>
        <p className="text-prism-muted text-sm mb-6 max-w-2xl">
          The provided XDR input exceeds the maximum allowed size. Please submit a smaller payload.
        </p>
      </div>
    );
  }

  const result = input ? await decodeXdrAction(input) : null;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">XDR Decoder</h1>
      <p className="text-prism-muted text-sm mb-6 max-w-2xl">
        Paste any base64 XDR blob — a transaction envelope from Horizon, a result or meta field, a ledger
        entry or key, a contract spec entry, or a bare ScVal. XDR carries no type tag, so Prism identifies
        the type by decoding and re-encoding each candidate and keeping the one that reproduces your input
        exactly.
      </p>
      <XdrDecoder initialInput={input} initialResult={result} />
    </div>
  );
}
