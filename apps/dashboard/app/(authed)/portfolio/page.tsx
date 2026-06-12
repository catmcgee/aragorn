"use client";

import { useEffect, useState } from "react";
import type { ContractRow, Portfolio } from "@aragorn/sdk";
import { useRing } from "@/lib/ring";
import { TEMPLATE_NAMES } from "@/lib/format";
import Amount from "@/components/Amount";
import Term from "@/components/Term";
import { HashChip, PartyName } from "@/components/chips";
import { LockRing, SettlementRing, type SettlementState } from "@/components/rings";

// Note lifecycle as ring geometry (PLAN §6.2).
const STATUS_RING: Record<ContractRow["status"], SettlementState> = {
  active: "final",
  pending_consume: "inflight",
  consumed: "consumed",
};

function isEncumberedBond(c: ContractRow): boolean {
  if (c.template_id !== 2) return false;
  try {
    return BigInt(c.payload.encumbrance ?? "0x0") !== 0n;
  } catch {
    return false;
  }
}

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
      <div>
        <h1 className="page-title">Portfolio</h1>
        <p className="page-caption">
          Positions for the parties you hold read-as entitlements on.
        </p>
      </div>
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
                <th className="th-num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(portfolio.balances).map(([party, micro]) => (
                <tr key={party}>
                  <td className="td">
                    <PartyName party={party} />
                  </td>
                  <td className="td-num">
                    <Amount micro={micro} />
                  </td>
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
                <th className="th">Contract</th>
                <th className="th">Template</th>
                <th className="th">Holder</th>
                <th className="th-num">Amount</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.cid}>
                  <td className="td">
                    <HashChip value={c.cid} />
                  </td>
                  <td className="td">
                    <span className="inline-flex items-center gap-1.5">
                      {TEMPLATE_NAMES[c.template_id] ?? `Template ${c.template_id}`}
                      {isEncumberedBond(c) && (
                        <Term t="encumbered">
                          <LockRing size={13} className="-mb-0.5" />
                        </Term>
                      )}
                    </span>
                  </td>
                  <td className="td">
                    <PartyName party={c.owner_party} />
                  </td>
                  <td className="td-num">
                    <Amount micro={c.amount_micro} />
                  </td>
                  <td className="td">
                    <span className="inline-flex items-center gap-1.5 text-slate-300">
                      <SettlementRing state={STATUS_RING[c.status]} title={c.status} />
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
