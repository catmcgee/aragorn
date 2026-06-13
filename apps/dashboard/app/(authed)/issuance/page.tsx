"use client";

// Issuance — the Registry: terms + holder ledger of bond positions on this
// Ring (registrar view, PLAN §6). The demo bond is seeded; Issue / DvP /
// coupon flows are designed but not shipped, so they render as Roadmap greys.

import { useEffect, useState } from "react";
import { cleanError } from "@aragorn/sdk";
import type { ContractRow } from "@aragorn/sdk";
import { useRing } from "@/lib/ring";
import Amount from "@/components/Amount";
import Term from "@/components/Term";
import { HashChip, PartyName } from "@/components/chips";
import { LockRing, SettlementRing } from "@/components/rings";
import { RoadmapBadge } from "@/components/RoadmapBox";

// The ISIN travels as a hash commitment; the demo bond gets a desk label.
const DEMO_ISIN_LABEL = "US91282CEZ-DEMO";
const DEMO_ISSUER = "US Treasury";

function isEncumbered(c: ContractRow): boolean {
  try {
    return BigInt(c.payload.encumbrance ?? "0x0") !== 0n;
  } catch {
    return false;
  }
}

function bondFace(c: ContractRow): string | null {
  try {
    return BigInt(c.payload.face_amount).toString();
  } catch {
    return null;
  }
}

export default function IssuancePage() {
  const { client, tick } = useRing();
  const [bonds, setBonds] = useState<ContractRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    client
      .contracts({ template: 2 })
      .then((r) => live && setBonds(r.contracts))
      .catch((e) => live && setError(cleanError(e)));
    return () => {
      live = false;
    };
  }, [client, tick]);

  return (
    <div className="px-8 py-6 max-w-[1180px] space-y-6">
      <div>
        <div className="page-eyebrow">Registry</div>
        <h1 className="page-title">Issuance</h1>
        <p className="page-caption">
          The Registry — <Term t="registrar" /> view: terms and holder ledger of
          bond positions held on this Ring.
        </p>
      </div>
      {error && <p className="err">{error}</p>}

      <section className="card">
        <h2 className="section-title">Registry</h2>
        {!bonds ? (
          <p className="text-sm text-ink-5">Loading…</p>
        ) : bonds.length === 0 ? (
          <p className="text-sm text-ink-5">No bond positions on this Ring.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="th">ISIN</th>
                <th className="th">Issuer</th>
                <th className="th-num">Face amount</th>
                <th className="th">Holder</th>
                <th className="th">Encumbrance</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody>
              {bonds.map((b) => {
                const enc = isEncumbered(b);
                return (
                  <tr
                    key={b.cid}
                    className="border-t border-line-soft hover:bg-[rgb(23_32_42/0.035)]"
                  >
                    <td className="td">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-[12px] text-ink-2">
                          {DEMO_ISIN_LABEL}
                        </span>
                        <HashChip value={b.payload.isin_hash} />
                      </span>
                    </td>
                    <td className="td">{DEMO_ISSUER}</td>
                    <td className="td-num">
                      <Amount micro={bondFace(b)} />
                    </td>
                    <td className="td">
                      <PartyName party={b.owner_party} />
                    </td>
                    <td className="td">
                      {enc ? (
                        <span className="flex items-center gap-2">
                          <span className="pill pill-enc">
                            <LockRing size={12} />
                            <Term t="encumbered" />
                          </span>
                          <HashChip value={b.payload.encumbrance} />
                        </span>
                      ) : (
                        <span className="text-ink-5">Unencumbered</span>
                      )}
                    </td>
                    <td className="td">
                      <span className="inline-flex items-center gap-1.5 text-ink-3">
                        <SettlementRing
                          state={
                            b.status === "active"
                              ? "final"
                              : b.status === "pending_consume"
                                ? "inflight"
                                : "consumed"
                          }
                          title={b.status}
                        />
                        {b.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {bonds && bonds.some(isEncumbered) && (
          <p className="mt-3 text-[11px] text-ink-5">
            Encumbered positions are pledged under a governing agreement — the
            chip names the agreement commitment. They cannot move until the{" "}
            <Term t="off-leg" /> releases them.
          </p>
        )}
      </section>

      <section className="roadmap-box">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[11px] font-medium tracking-[0.18em] text-ink-5 uppercase">
            Registrar actions
          </h2>
          <RoadmapBadge />
        </div>
        <p className="mt-2 text-sm text-ink-5">
          Primary issuance, <Term t="DvP" /> against cash, and coupon runs are
          designed into the protocol — the demo seeds the bond instead.
        </p>
        <div className="mt-3 flex gap-2">
          <button className="btn" disabled>
            Issue bond
          </button>
          <button className="btn" disabled>
            Run DvP
          </button>
          <button className="btn" disabled>
            Pay coupon
          </button>
        </div>
      </section>
    </div>
  );
}
