'use client';

import { useEffect, useMemo, useState } from 'react';
import { CopyButton } from '@/components/CopyButton';

interface ContractEntry {
  id: string;
  name?: string;
  network?: string;
}

interface TransactionEntry {
  hash: string;
  status?: string;
  ledger?: number;
}

interface AccountEntry {
  address: string;
  balance?: string;
}

function truncate(value: string, head = 6, tail = 6): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function Identifier({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-sm">
      <span title={value}>{truncate(value)}</span>
      <CopyButton value={value} label={label} />
    </span>
  );
}

export default function ExplorerPage() {
  const [contracts, setContracts] = useState<ContractEntry[]>([]);
  const [transactions, setTransactions] = useState<TransactionEntry[]>([]);
  const [accounts, setAccounts] = useState<AccountEntry[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [contractsRes, txRes, accountsRes] = await Promise.all([
          fetch('/api/contracts').then((r) => (r.ok ? r.json() : [])),
          fetch('/api/transactions').then((r) => (r.ok ? r.json() : [])),
          fetch('/api/accounts').then((r) => (r.ok ? r.json() : [])),
        ]);
        if (cancelled) return;
        setContracts(Array.isArray(contractsRes) ? contractsRes : []);
        setTransactions(Array.isArray(txRes) ? txRes : []);
        setAccounts(Array.isArray(accountsRes) ? accountsRes : []);
      } catch {
        if (!cancelled) {
          setContracts([]);
          setTransactions([]);
          setAccounts([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredContracts = useMemo(
    () =>
      contracts.filter((c) =>
        `${c.id} ${c.name ?? ''}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [contracts, query],
  );

  const filteredTransactions = useMemo(
    () =>
      transactions.filter((t) =>
        t.hash.toLowerCase().includes(query.toLowerCase()),
      ),
    [transactions, query],
  );

  const filteredAccounts = useMemo(
    () =>
      accounts.filter((a) =>
        a.address.toLowerCase().includes(query.toLowerCase()),
      ),
    [accounts, query],
  );

  return (
    <div className="space-y-8 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Explorer</h1>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by contract ID, tx hash, or address"
          aria-label="Filter identifiers"
          className="w-full max-w-md rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        />
      </header>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          <section aria-labelledby="contracts-heading" className="space-y-3">
            <h2 id="contracts-heading" className="text-lg font-medium">
              Contracts
            </h2>
            {filteredContracts.length === 0 ? (
              <p className="text-sm text-gray-500">No contracts found.</p>
            ) : (
              <div className="max-h-[28rem] overflow-auto rounded border border-gray-200">
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 z-10 bg-white shadow-sm">
                    <tr className="border-b border-gray-200">
                      <th scope="col" className="px-4 py-3 text-sm font-medium">
                        Name
                      </th>
                      <th scope="col" className="px-4 py-3 text-right text-sm font-medium">
                        Contract ID
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredContracts.map((c) => (
                      <tr key={c.id}>
                        <td className="px-4 py-3 text-sm">
                          {c.name ?? 'Unnamed contract'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Identifier value={c.id} label="contract ID" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="transactions-heading" className="space-y-3">
            <h2 id="transactions-heading" className="text-lg font-medium">
              Transactions
            </h2>
            {filteredTransactions.length === 0 ? (
              <p className="text-sm text-gray-500">No transactions found.</p>
            ) : (
              <div className="max-h-[28rem] overflow-auto rounded border border-gray-200">
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 z-10 bg-white shadow-sm">
                    <tr className="border-b border-gray-200">
                      <th scope="col" className="px-4 py-3 text-sm font-medium">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-3 text-right text-sm font-medium">
                        Transaction hash
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredTransactions.map((t) => (
                      <tr key={t.hash}>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {t.status ?? 'unknown'}
                          {typeof t.ledger === 'number' ? ` · ledger ${t.ledger}` : ''}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Identifier value={t.hash} label="transaction hash" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="accounts-heading" className="space-y-3">
            <h2 id="accounts-heading" className="text-lg font-medium">
              Accounts
            </h2>
            {filteredAccounts.length === 0 ? (
              <p className="text-sm text-gray-500">No accounts found.</p>
            ) : (
              <div className="max-h-[28rem] overflow-auto rounded border border-gray-200">
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 z-10 bg-white shadow-sm">
                    <tr className="border-b border-gray-200">
                      <th scope="col" className="px-4 py-3 text-sm font-medium">
                        Balance
                      </th>
                      <th scope="col" className="px-4 py-3 text-right text-sm font-medium">
                        Address
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredAccounts.map((a) => (
                      <tr key={a.address}>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {a.balance ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Identifier value={a.address} label="account address" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
