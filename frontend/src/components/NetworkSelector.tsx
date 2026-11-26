"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { NETWORKS, type StellarNetwork } from "@/lib/config";

interface NetworkSelectorProps {
  current: StellarNetwork;
}

/**
 * A drop-down that lets the user switch the active Stellar network.
 *
 * The selection is passed as a `?network=<value>` query parameter so that the
 * server can resolve which endpoints to use for the next navigation. This keeps
 * the selector compatible with server components: no client-side state leaks
 * into server renders.
 */
export function NetworkSelector({ current }: NetworkSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as StellarNetwork;
    const params = new URLSearchParams(searchParams.toString());
    params.set("network", next);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <select
      aria-label="Select Stellar network"
      value={current}
      onChange={handleChange}
      className="text-xs font-mono bg-transparent border border-prism-border rounded px-1.5 py-0.5 text-prism-muted hover:text-prism-strong focus:outline-none cursor-pointer"
    >
      {NETWORKS.map((network) => (
        <option key={network} value={network}>
          {network}
        </option>
      ))}
    </select>
  );
}
