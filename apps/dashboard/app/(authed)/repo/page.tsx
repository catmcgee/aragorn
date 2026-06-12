"use client";

// Repo blotter — book bilateral repos against bond collateral (atomic DvP),
// accept inbound proposals, and close live agreements. The repo endpoints are
// not in @aragorn/sdk yet, so this page uses raw authed fetch (same pattern as My Pay).

import { useEffect, useState } from "react";
import type { ContractRow } from "@aragorn/sdk";
import { useRing, getStoredToken } from "@/lib/ring";
import { fmtMicro, shortHex, usdcToMicro } from "@/lib/format";

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

const STATUS_CHIP: Record<RepoStatus, string> = {
  proposed: "bg-blue-500/15 text-blue-400",
  inbound: "bg-amber-500/15 text-amber-400",
  live: "bg-emerald-500/15 text-emerald-400",
  closed: "bg-slate-500/15 text-slate-400",
  pending_approval: "bg-orange-500/15 text-orange-400",
  rejected: "bg-red-500/15 text-red-400",
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
  const { client, me, ringUrl, tick } = useRing();
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [bonds, setBonds] = useState<ContractRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  // book form
  const [collateralCid, setCollateralCid] = useState("");
  const [dealerParty, setDealerParty] = useState(me.user.actAs[0] ?? "trading");
  const [counterpartyEns, setCounterpartyEns] = useState("drw.aragornrings.eth");
  const [cash, setCash] = useState("");
  const [rateBps, setRateBps] = useState("");
  const [days, setDays] = useState("1");
  const [booking, setBooking] = useState(false);
  const [bookResult, setBookResult] = useState<string | null>(null);
  const [bookPending, setBookPending] = useState<string | null>(null);

  // per-row action state
  const [busyId, setBusyId] = useState<number | null>(null);
  const [outcomes, setOutcomes] = useState<Record<number, string>>({});

  useEffect(() => {
    let live = true;
    authedFetch(ringUrl, "/v1/repos")
      .then((r) => live && setRepos((r.repos as Repo[]) ?? []))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
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
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
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
        setBookResult(
          `Proposed — tx ${res.txid}${res.proposalCid ? ` · proposal ${shortHex(String(res.proposalCid))}` : ""}`,
        );
      }
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBooking(false);
    }
  }

  async function accept(id: number) {
    setBusyId(id);
    try {
      const res = await authedFetch(ringUrl, `/v1/repos/${id}/accept`);
      setOutcomes((o) => ({ ...o, [id]: `Settled — tx ${res.txid}` }));
      setRefresh((n) => n + 1);
    } catch (e) {
      setOutcomes((o) => ({ ...o, [id]: e instanceof Error ? e.message : String(e) }));
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
        [id]: `Closed — tx ${res.txid} · repurchase ${fmtMicro(res.repurchaseMicro as string)}`,
      }));
      setRefresh((n) => n + 1);
    } catch (e) {
      setOutcomes((o) => ({ ...o, [id]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-100">Repo</h1>
      {error && <p className="err">{error}</p>}

      <form className="card max-w-lg space-y-4" onSubmit={book}>
        <h2 className="section-title">Book repo</h2>

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
            <p className="text-sm text-slate-500">No unencumbered bond positions.</p>
          )}
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
              Rate (bps)
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

        {bookPending && <p className="text-sm text-amber-400">{bookPending}</p>}
        {bookResult && (
          <p className="font-mono text-sm text-emerald-400">{bookResult}</p>
        )}
      </form>

      <section className="card">
        <h2 className="section-title">Blotter</h2>
        {!repos ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : repos.length === 0 ? (
          <p className="text-sm text-slate-500">No repos.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">#</th>
                <th className="th">Side</th>
                <th className="th">Status</th>
                <th className="th">Counterparty</th>
                <th className="th">Principal</th>
                <th className="th">Rate</th>
                <th className="th">Term</th>
                <th className="th">Maturity</th>
                <th className="th">Repurchase</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {repos.map((r) => (
                <tr key={r.id}>
                  <td className="td tabular-nums">{r.id}</td>
                  <td className="td">{r.state.side ?? "—"}</td>
                  <td className="td">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        STATUS_CHIP[r.status] ?? "bg-slate-500/15 text-slate-400"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="td font-mono text-xs">
                    {r.state.counterpartyEns ?? "—"}
                  </td>
                  <td className="td tabular-nums">
                    {fmtMicro(r.state.cashAmountMicro)}
                  </td>
                  <td className="td tabular-nums">
                    {r.state.rateBps !== undefined
                      ? `${r.state.rateBps / 100}%`
                      : "—"}
                  </td>
                  <td className="td tabular-nums">
                    {r.state.days !== undefined ? `${r.state.days}d` : "—"}
                  </td>
                  <td className="td text-xs">
                    {r.state.maturityTs
                      ? new Date(r.state.maturityTs * 1000).toLocaleString()
                      : "—"}
                  </td>
                  <td className="td tabular-nums">
                    {r.state.repurchaseMicro
                      ? fmtMicro(r.state.repurchaseMicro)
                      : "—"}
                  </td>
                  <td className="td">
                    {r.status === "inbound" && (
                      <button
                        className="btn"
                        disabled={busyId === r.id}
                        onClick={() => accept(r.id)}
                      >
                        Accept (atomic DvP)
                      </button>
                    )}
                    {r.status === "live" && (
                      <button
                        className="btn"
                        disabled={busyId === r.id}
                        onClick={() => close(r.id)}
                      >
                        Close now
                      </button>
                    )}
                    {outcomes[r.id] && (
                      <p className="mt-1 font-mono text-xs text-slate-400">
                        {outcomes[r.id]}
                      </p>
                    )}
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
