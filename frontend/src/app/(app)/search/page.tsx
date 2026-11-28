import { redirect } from "next/navigation";
import SearchBar from "@/components/SearchBar";
import EventLog from "@/components/EventLog";
import { resolveSearchRoute } from "@/lib/search";
import { searchEvents } from "@/lib/soroban";
import { isIndexerConfigured } from "@/lib/indexed-db";

interface Props { searchParams: { q?: string } }

export default async function SearchPage({ searchParams }: Props) {
  const query = (searchParams.q ?? "").trim();

  if (query) {
    const route = resolveSearchRoute(query);
    // Only redirect if the route is not /search itself (avoid infinite loop)
    if (route && !route.startsWith("/search")) redirect(route);
  }

  const events = query ? await searchEvents(query) : [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Search</h1>
      <SearchBar initialValue={query} />
      {query && events.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold mb-3">Matching events</h2>
          <EventLog events={events} />
        </section>
      )}
      {query && events.length === 0 && (
        <p className="text-prism-muted mt-6 text-sm">
          {isIndexerConfigured()
            ? `No match for "${query}". Try a transaction hash, a contract ID (starts with C), an account address (starts with G), a ledger sequence number, or a word from an event topic or value.`
            : `No match for "${query}". Try a transaction hash, a contract ID (starts with C), an account address (starts with G), or a ledger sequence number.`}
        </p>
      )}
    </div>
  );
}
