"use client";

import { useEffect, useState } from "react";
import { cleanError } from "@aragorn/sdk";
import type { ContractRow, Portfolio } from "@aragorn/sdk";
import { useRing } from "@/lib/ring";
import { fmtMicro, TEMPLATE_NAMES } from "@/lib/format";
import Amount from "@/components/Amount";
import Term from "@/components/Term";
import { HashChip, PartyName, partyLabel } from "@/components/chips";
import { LockRing, SettlementRing, type SettlementState } from "@/components/rings";

// Note lifecycle as ring geometry (PLAN §6.2).
const STATUS_RING: Record<ContractRow["status"], SettlementState> = {
  active: "final",
  pending_consume: "inflight",
  consumed: "consumed",
};

const STATUS_PILL: Record<ContractRow["status"], string> = {
  active: "pill pill-held",
  pending_consume: "pill pill-neutral",
  consumed: "pill pill-neutral",
};

function isEncumberedBond(c: ContractRow): boolean {
  if (c.template_id !== 2) return false;
  try {
    return BigInt(c.payload.encumbrance ?? "0x0") !== 0n;
  } catch {
    return false;
  }
}

/** Sum a record of micro-USDC balances, BigInt-safe. */
function sumMicro(balances: Record<string, string>): string {
  let total = 0n;
  for (const v of Object.values(balances)) {
    try {
      total += BigInt(v);
    } catch {
      /* skip unparseable */
    }
  }
  return total.toString();
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
      .catch((e) => live && setError(cleanError(e)));
    client
      .contracts()
      .then((r) => live && setContracts(r.contracts))
      .catch((e) => live && setError(cleanError(e)));
    return () => {
      live = false;
    };
  }, [client, tick]);

  // KPI figures from real data only.
  const nav = portfolio ? fmtMicro(sumMicro(portfolio.balances)) : null;
  const openPositions =
    contracts === null ? null : contracts.filter((c) => c.status === "active").length;
  const partyCount = portfolio ? Object.keys(portfolio.balances).length : null;

  // Group holdings by holder party for the department sections.
  const byParty = new Map<string, ContractRow[]>();
  for (const c of contracts ?? []) {
    const key = c.owner_party ?? "—";
    (byParty.get(key) ?? byParty.set(key, []).get(key)!).push(c);
  }

  return (
    <div className="px-8 py-6 max-w-[1180px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="page-eyebrow">Portfolio</div>
          <h1 className="page-title">Portfolio</h1>
        </div>
      </div>

      {/* Tab row — Overview active, others inert previews. */}
      <div className="mt-4 flex items-center gap-6 border-b border-line-soft">
        <span className="-mb-px border-b-2 border-gold pb-2 text-[13px] font-medium text-ink">
          Overview
        </span>
        <span className="pb-2 text-[13px] text-ink-6">Departments</span>
        <span className="pb-2 text-[13px] text-ink-6">History</span>
      </div>

      {error && <p className="err">{error}</p>}

      {/* KPI stat cards — computed from real portfolio data. */}
      <div className="mt-5 flex gap-3 overflow-x-auto pb-1">
        <div className="shrink-0 w-[188px] card">
          <div className="text-[11px] text-ink-5">Net asset value</div>
          <div className="text-2xl tracking-[-0.02em] text-ink my-1.5">
            {nav ?? "—"}
          </div>
          <div className="text-[11px] text-ink-6">Across all departments</div>
        </div>
        <div className="shrink-0 w-[188px] card">
          <div className="text-[11px] text-ink-5">Open positions</div>
          <div className="text-2xl tracking-[-0.02em] text-ink my-1.5">
            {openPositions ?? "—"}
          </div>
          <div className="text-[11px] text-ink-6">Active contracts on this Ring</div>
        </div>
        <div className="shrink-0 w-[188px] card">
          <div className="text-[11px] text-ink-5">Departments</div>
          <div className="text-2xl tracking-[-0.02em] text-ink my-1.5">
            {partyCount ?? "—"}
          </div>
          <div className="text-[11px] text-ink-6">Parties you read as</div>
        </div>
      </div>

      {/* Balances by department. */}
      <section className="mt-7">
        <div className="flex items-center gap-2.5 mb-2">
          <span className="h-[3px] w-4 rounded-sm bg-gold shrink-0" />
          <span className="text-[11px] tracking-[0.14em] uppercase text-ink-4">
            Balances
          </span>
          {partyCount !== null && (
            <span className="text-[10.5px] text-ink-6">
              {partyCount} {partyCount === 1 ? "party" : "parties"}
            </span>
          )}
          <div className="flex-1 h-px bg-line-soft" />
        </div>
        <div className="card-flat overflow-hidden">
          {!portfolio ? (
            <p className="p-4 text-sm text-ink-5">Loading…</p>
          ) : Object.keys(portfolio.balances).length === 0 ? (
            <p className="p-4 text-sm text-ink-5">No balances.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="th">Party</th>
                  <th className="th-num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(portfolio.balances).map(([party, micro]) => (
                  <tr
                    key={party}
                    className="border-t border-line-soft hover:bg-[rgb(23_32_42/0.035)]"
                  >
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
        </div>
      </section>

      {/* Holdings grouped by department/party. */}
      <section className="mt-7 space-y-6">
        {!contracts ? (
          <div className="flex items-center gap-2.5 mb-2">
            <span className="h-[3px] w-4 rounded-sm bg-gold shrink-0" />
            <span className="text-[11px] tracking-[0.14em] uppercase text-ink-4">
              Holdings
            </span>
            <div className="flex-1 h-px bg-line-soft" />
          </div>
        ) : contracts.length === 0 ? (
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="h-[3px] w-4 rounded-sm bg-gold shrink-0" />
              <span className="text-[11px] tracking-[0.14em] uppercase text-ink-4">
                Holdings
              </span>
              <div className="flex-1 h-px bg-line-soft" />
            </div>
            <p className="text-sm text-ink-5">No contracts.</p>
          </div>
        ) : (
          [...byParty.entries()].map(([party, rows]) => (
            <div key={party}>
              <div className="flex items-center gap-2.5 mb-2">
                <span className="h-[3px] w-4 rounded-sm bg-gold shrink-0" />
                <span className="text-[11px] tracking-[0.14em] uppercase text-ink-4">
                  {partyLabel(party)}
                </span>
                <span className="text-[10.5px] text-ink-6">
                  {rows.length} {rows.length === 1 ? "position" : "positions"}
                </span>
                <div className="flex-1 h-px bg-line-soft" />
              </div>
              <div className="card-flat overflow-hidden">
                <table className="w-full border-collapse">
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
                    {rows.map((c) => {
                      const enc = isEncumberedBond(c);
                      return (
                        <tr
                          key={c.cid}
                          className="border-t border-line-soft hover:bg-[rgb(23_32_42/0.035)]"
                        >
                          <td className="td">
                            <HashChip value={c.cid} />
                          </td>
                          <td className="td">
                            <span className="inline-flex items-center gap-1.5">
                              {TEMPLATE_NAMES[c.template_id] ??
                                `Template ${c.template_id}`}
                              {enc && (
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
                            {enc ? (
                              <span className="pill pill-enc">
                                <LockRing size={12} />
                                encumbered
                              </span>
                            ) : (
                              <span className={STATUS_PILL[c.status]}>
                                <SettlementRing
                                  state={STATUS_RING[c.status]}
                                  size={12}
                                  title={c.status}
                                />
                                {c.status}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
