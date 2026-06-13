"use client";

// Repo blotter — book bilateral repos against bond collateral (atomic DvP),
// accept inbound proposals, and close live agreements. The repo endpoints are
// not in @aragorn/sdk yet, so this page uses raw authed fetch (same pattern as My Pay).

import { useEffect, useState } from "react";
import { cleanError } from "@aragorn/sdk";
import type { ContractRow } from "@aragorn/sdk";
import { useRing, getStoredToken } from "@/lib/ring";
import { fmtMicro, shortHex, usdcToMicro } from "@/lib/format";
import Amount from "@/components/Amount";
import Term from "@/components/Term";
import { HashChip, TxNote } from "@/components/chips";
import { RoadmapBadge } from "@/components/RoadmapBox";

type RepoStatus =
  | "proposed"
  | "inbound"
  | "live"
  | "closed"
  | "pending_approval"
  | "rejected";

interface Repo {
  id: number;
  kind: string;
  status: RepoStatus;
  state: {
    side?: string;
    counterpartyEns?: string;
    proposalCid?: string;
    agreementCid?: string;
    cashAmountMicro?: string;
    rateBps?: number;
    days?: number;
    maturityTs?: number;
    repurchaseMicro?: string;
    collateralCid?: string;
    faceAmountMicro?: string;
  };
  created_by: string;
  created_at: string;
}

// Lifecycle as semantic status pill (PLAN §6.2).
const STATUS_PILL: Record<RepoStatus, string> = {
  proposed: "pill pill-held",
  inbound: "pill pill-held",
  live: "pill pill-held",
  closed: "pill pill-pos",
  pending_approval: "pill pill-neutral",
  rejected: "pill pill-neutral",
};

const ZERO = 0n;

async function authedFetch(
  ringUrl: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const token = getStoredToken();
  const res = await fetch(`${ringUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok && res.status !== 202) {
    throw new Error((json.error as string) ?? `HTTP ${res.status}`);
  }
  return json;
}

/** Free-to-pledge bonds: active and unencumbered (encumbrance hex parses to 0). */
function isFreeBond(c: ContractRow): boolean {
  if (c.status !== "active") return false;
  try {
    return BigInt(c.payload.encumbrance ?? "0x0") === ZERO;
  } catch {
    return false;
  }
}

function bondFace(c: ContractRow): string {
  try {
    return BigInt(c.payload.face_amount).toString();
  } catch {
    return "";
  }
}

export default function RepoPage() {
  const { client, me, ringUrl, tick, openPublic } = useRing();
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [bonds, setBonds] = useState<ContractRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  // book form
  const [collateralCid, setCollateralCid] = useState("");
  // dealer party defaults to where collateral lives (trading desk holds the bonds), not actAs[0]
  const [dealerParty, setDealerParty] = useState(
    me.user.actAs.includes("trading") ? "trading" : (me.user.actAs[0] ?? "trading"),
  );
  // counterparty defaults to the first whitelisted name (set in the effect below), not a hardcode
  const [counterpartyEns, setCounterpartyEns] = useState("");
  const [cash, setCash] = useState("");
  const [rateBps, setRateBps] = useState("");
  const [days, setDays] = useState("1");
  const [booking, setBooking] = useState(false);
  const [bookResult, setBookResult] = useState<{ label: string; txid?: string } | null>(null);
  const [bookPending, setBookPending] = useState<string | null>(null);

  // per-row action state
  const [busyId, setBusyId] = useState<number | null>(null);
  const [outcomes, setOutcomes] = useState<Record<number, { label: string; txid?: string }>>({});

  useEffect(() => {
    let live = true;
    authedFetch(ringUrl, "/v1/repos")
      .then((r) => live && setRepos((r.repos as Repo[]) ?? []))
      .catch((e) => live && setError(cleanError(e)));
    client
      .contracts({ template: 2 })
      .then((r) => {
        if (!live) return;
        const free = r.contracts.filter(isFreeBond);
        setBonds(free);
        setCollateralCid((cur) =>
          cur && free.some((b) => b.cid === cur) ? cur : (free[0]?.cid ?? ""),
        );
      })
      .catch((e) => live && setError(cleanError(e)));
    // default the counterparty to the first whitelisted ring (unless the user has typed one)
    authedFetch(ringUrl, "/v1/whitelist")
      .then((r) => {
        if (!live) return;
        const rows = (Array.isArray(r) ? r : (r.whitelist ?? r.rows ?? [])) as Array<{ ens_name?: string }>;
        const first = rows[0]?.ens_name;
        if (first) setCounterpartyEns((cur) => cur || first);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [client, ringUrl, tick, refresh]);

  async function book(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBookResult(null);
    setBookPending(null);
    setBooking(true);
    try {
      const res = await authedFetch(ringUrl, "/v1/repos", {
        dealerParty: dealerParty.trim(),
        counterpartyEns: counterpartyEns.trim(),
        collateralCid,
        cashAmountMicro: usdcToMicro(cash).toString(),
        rateBps: Number(rateBps),
        days: Number(days),
      });
      if (res.status === "pending_approval") {
        setBookPending(
          `Routed to approver — four-eyes (approval #${res.approvalId})`,
        );
      } else {
        setBookResult({
          label: `Proposed${res.proposalCid ? ` · proposal ${shortHex(String(res.proposalCid))} ·` : ""} tx`,
          txid: String(res.txid),
        });
      }
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBooking(false);
    }
  }

  async function accept(id: number) {
    setBusyId(id);
    try {
      const res = await authedFetch(ringUrl, `/v1/repos/${id}/accept`);
      setOutcomes((o) => ({ ...o, [id]: { label: "Settled — tx", txid: String(res.txid) } }));
      setRefresh((n) => n + 1);
    } catch (e) {
      setOutcomes((o) => ({ ...o, [id]: { label: cleanError(e) } }));
    } finally {
      setBusyId(null);
    }
  }

  async function close(id: number) {
    setBusyId(id);
    try {
      const res = await authedFetch(ringUrl, `/v1/repos/${id}/close`);
      setOutcomes((o) => ({
        ...o,
        [id]: {
          label: `Closed · repurchase ${fmtMicro(res.repurchaseMicro as string)} · tx`,
          txid: String(res.txid),
        },
      }));
      setRefresh((n) => n + 1);
    } catch (e) {
      setOutcomes((o) => ({ ...o, [id]: { label: cleanError(e) } }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="px-8 py-6 max-w-[1180px] space-y-6">
      <div>
        <div className="page-eyebrow">Repo</div>
        <h1 className="page-title">
          <Term t="blotter">Blotter</Term>
        </h1>
        <p className="page-caption">
          Book bilateral repos against bond collateral — both legs settle as
          atomic <Term t="DvP" />.
        </p>
      </div>
      {error && <p className="err">{error}</p>}

      <form className="card max-w-lg space-y-4" onSubmit={book}>
        <h2 className="section-title">
          Book repo — <Term t="term sheet" />
        </h2>

        <div>
          <label className="label" htmlFor="collateral">
            Collateral (free bond positions)
          </label>
          {bonds.length > 0 ? (
            <select
              id="collateral"
              className="input w-full"
              value={collateralCid}
              onChange={(e) => setCollateralCid(e.target.value)}
            >
              {bonds.map((b) => (
                <option key={b.cid} value={b.cid}>
                  Bond {shortHex(b.cid)} — face {fmtMicro(bondFace(b))}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-ink-5">
              No <Term t="encumbered">unencumbered</Term> bond positions.
            </p>
          )}
          <p className="mt-1 text-[11px] text-ink-5">
            No <Term t="haircut" /> in this demo — collateral pledged at face on
            the <Term t="on-leg" />.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="dealer">
            Dealer party
          </label>
          <input
            id="dealer"
            className="input w-full"
            value={dealerParty}
            onChange={(e) => setDealerParty(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="counterparty">
            Counterparty ENS
          </label>
          <input
            id="counterparty"
            className="input w-full"
            value={counterpartyEns}
            onChange={(e) => setCounterpartyEns(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="label" htmlFor="cash">
              Cash amount (USDC)
            </label>
            <input
              id="cash"
              className="input w-full"
              placeholder="1000000.00"
              inputMode="decimal"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
            />
          </div>
          <div className="w-28">
            <label className="label" htmlFor="rate">
              Rate (bps · <Term t="ACT/360" />)
            </label>
            <input
              id="rate"
              className="input w-full"
              placeholder="530"
              inputMode="numeric"
              value={rateBps}
              onChange={(e) => setRateBps(e.target.value)}
            />
          </div>
          <div className="w-20">
            <label className="label" htmlFor="days">
              Days
            </label>
            <input
              id="days"
              className="input w-full"
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
        </div>

        <button
          type="submit"
          className="btn-primary"
          disabled={
            booking ||
            !collateralCid ||
            !dealerParty.trim() ||
            !counterpartyEns.trim() ||
            !cash.trim() ||
            !rateBps.trim() ||
            !days.trim()
          }
        >
          {booking ? "Booking…" : "Book repo"}
        </button>

        {bookPending && <p className="text-sm text-gold-deep">{bookPending}</p>}
        {bookResult && (
          <p className="font-mono text-sm text-pos">
            <TxNote label={bookResult.label} txid={bookResult.txid} />
          </p>
        )}
      </form>

      <section className="card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="section-title mb-0">Blotter</h2>
          {/* In-page greys on a live module (PLAN §6): visible, disabled, badged. */}
          <div className="flex items-center gap-2">
            <button className="btn" disabled>
              Margin call
            </button>
            <button className="btn" disabled>
              Substitution
            </button>
            <button className="btn" disabled>
              Netting
            </button>
            <RoadmapBadge />
          </div>
        </div>
        {!repos ? (
          <p className="text-sm text-ink-5">Loading…</p>
        ) : repos.length === 0 ? (
          <p className="text-sm text-ink-5">No repos.</p>
        ) : (
          <div className="card-flat overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="th">#</th>
                  <th className="th">Side</th>
                  <th className="th">Status</th>
                  <th className="th">Counterparty</th>
                  <th className="th-num">
                    <Term t="notional">Principal</Term>
                  </th>
                  <th className="th-num">Rate</th>
                  <th className="th-num">Term</th>
                  <th className="th">
                    <Term t="off-leg">Off-leg</Term>
                  </th>
                  <th className="th-num">Repurchase</th>
                  <th className="th" />
                  <th className="th-num">Chain</th>
                </tr>
              </thead>
              <tbody>
                {repos.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-line-soft hover:bg-[rgb(23_32_42/0.035)]"
                  >
                    <td className="td tabular-nums">{r.id}</td>
                    <td className="td">{r.state.side ?? "—"}</td>
                    <td className="td">
                      <span
                        className={STATUS_PILL[r.status] ?? "pill pill-neutral"}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="td">{r.state.counterpartyEns ?? "—"}</td>
                    <td className="td-num">
                      <Amount micro={r.state.cashAmountMicro} />
                    </td>
                    <td className="td-num">
                      {r.state.rateBps !== undefined
                        ? `${r.state.rateBps / 100}%`
                        : "—"}
                    </td>
                    <td className="td-num">
                      {r.state.days !== undefined ? `${r.state.days}d` : "—"}
                    </td>
                    <td className="td text-xs">
                      {r.state.maturityTs
                        ? new Date(r.state.maturityTs * 1000).toLocaleString()
                        : "—"}
                    </td>
                    <td className="td-num">
                      {r.state.repurchaseMicro ? (
                        <Amount micro={r.state.repurchaseMicro} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="td">
                      {r.status === "inbound" && (
                        <button
                          className="btn whitespace-nowrap"
                          disabled={busyId === r.id}
                          onClick={() => accept(r.id)}
                        >
                          Accept — atomic <Term t="DvP" />
                        </button>
                      )}
                      {/* Closing is the dealer's action (it repurchases with its own cash);
                          the lender can't close, so only offer it on the dealer's row. */}
                      {r.status === "live" && r.state.side === "dealer" && (
                        <button
                          className="btn"
                          disabled={busyId === r.id}
                          onClick={() => close(r.id)}
                        >
                          Close now
                        </button>
                      )}
                      {r.status === "live" && r.state.side !== "dealer" && (
                        <span className="text-xs text-ink-5">live — dealer repurchases at maturity</span>
                      )}
                      {outcomes[r.id] && (
                        <p className="mt-1 font-mono text-xs text-ink-4">
                          <TxNote label={outcomes[r.id].label} txid={outcomes[r.id].txid} />
                        </p>
                      )}
                    </td>
                    <td className="td-num">
                      <button
                        className="public-pill"
                        onClick={() =>
                          openPublic(
                            r.state.agreementCid ?? r.state.proposalCid,
                          )
                        }
                      >
                        ⊙ Public
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
