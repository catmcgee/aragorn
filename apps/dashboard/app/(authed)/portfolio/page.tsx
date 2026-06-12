"use client";

import { useEffect, useState } from "react";
import type { ContractRow, Portfolio } from "@aragorn/sdk";
import { useRing } from "@/lib/ring";
import { fmtMicro, shortHex, STATUS_DOT, TEMPLATE_NAMES } from "@/lib/format";

export default function PortfolioPage() {
  const { client, tick } = useRing();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [contracts, setContracts] = useState<ContractRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    client
      .portfolio()
      .then((p) => live && setPortfolio(p))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    client
      .contracts()
      .then((r) => live && setContracts(r.contracts))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [client, tick]);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-100">Portfolio</h1>
      {error && <p className="err">{error}</p>}

      <section className="card">
        <h2 className="section-title">Balances</h2>
        {!portfolio ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : Object.keys(portfolio.balances).length === 0 ? (
          <p className="text-sm text-slate-500">No balances.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Party</th>
                <th className="th">Balance</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(portfolio.balances).map(([party, micro]) => (
                <tr key={party}>
                  <td className="td font-mono">{party}</td>
                  <td className="td tabular-nums">{fmtMicro(micro)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">Holdings</h2>
        {!contracts ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : contracts.length === 0 ? (
          <p className="text-sm text-slate-500">No contracts.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">CID</th>
                <th className="th">Template</th>
                <th className="th">Owner</th>
                <th className="th">Amount</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.cid}>
                  <td className="td font-mono" title={c.cid}>
                    {shortHex(c.cid)}
                  </td>
                  <td className="td">
                    {TEMPLATE_NAMES[c.template_id] ?? `Template ${c.template_id}`}
                  </td>
                  <td className="td font-mono">{c.owner_party ?? "—"}</td>
                  <td className="td tabular-nums">{fmtMicro(c.amount_micro)}</td>
                  <td className="td">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          STATUS_DOT[c.status] ?? "bg-slate-500"
                        }`}
                      />
                      {c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
