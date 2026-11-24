import type { Metadata } from "next";
import { config } from "@/lib/config";
import "../globals.css";
import Navbar from "@/components/Navbar";
import ConfigWarning from "@/components/ConfigWarning";
import Footer from "@/components/Footer";
import KeyboardShortcutsProvider from "@/components/KeyboardShortcutsProvider";

export const metadata: Metadata = {
  metadataBase: new URL(config.siteUrl),
  title: "Prism — Soroban Block Explorer",
  description: "Open-source block explorer with full Soroban smart contract support for the Stellar network.",
  openGraph: {
    title: "Prism Explorer",
    description: "Explore Stellar transactions, contracts, events, and storage.",
    type: "website",
  },
};

/**
 * The navbar badge and config banner are derived from environment variables,
 * which Next inlines into any page it prerenders at build time. Prism ships as
 * a Docker image built once and pointed at a network at run time, so /docs and
 * /xdr would otherwise keep claiming whatever network the image was built
 * with while every dynamic page reported the real one — the badge is only
 * worth having if it can't lie.
 */
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConfigWarning />
        <Navbar />
        <KeyboardShortcutsProvider />
        <main className="min-h-screen max-w-7xl mx-auto px-4 py-8">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
