"use client";

// Strategies — private treasury yield. A deposit consumes shielded cash, mints a private
// StrategyPosition note (the ZK-redeemable principal claim), and deploys into the Gauntlet
// USDC Prime vault (Morpho, Base) via Privy Earn. Redeem burns the note. The fully-private
// (position-as-note, direct DeFi) extension is the roadmap box.
// The strategies endpoints are not in @aragorn/sdk yet, so raw authed fetch.

import { useEffect, useState } from "react";
import { cleanError } from "@aragorn/sdk";
import { useRing, getStoredToken } from "@/lib/ring";
import { fmtMicro, usdcToMicro } from "@/lib/format";
import { HashChip } from "@/components/chips";
import RoadmapBox from "@/components/RoadmapBox";

interface StrategyPositionRow {
  cid: string;
  amount_micro: string | null;
  status: string;
  created_tx: string | null;
}

interface Strategies {
  earn: {
    enabled: boolean;
    position?: {
      assetsInVault: string;
      totalDeposited: string;
      earnedYield: string;
    };
    vault?: { apyBps: number; provider: string; tvlUsd: number };
  };
  // Shielded principal currently deployed to the strategy (the private UTXO backing Earn).
  deployedMicro?: string;
  roadmap: {
    privateStrategies: { title: string; blurb: string; status: string };
  };
}

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

export default function StrategiesPage() {
  const { ringUrl, tick } = useRing();
  const [data, setData] = useState<Strategies | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const [depositAmount, setDepositAmount] = useState("");
  const [desk, setDesk] = useState("treasury");
  const [positions, setPositions] = useState<StrategyPositionRow[]>([]);
  // "deposit" while depositing, or a position cid while that position is being redeemed.
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      authedFetch(ringUrl, "/v1/strategies"),
      authedFetch(ringUrl, "/v1/contracts?template=7"),
    ])
      .then(([s, p]) => {
        if (!live) return;
        setData(s as unknown as Strategies);
        const rows = ((p.contracts as StrategyPositionRow[]) ?? []).filter((r) => r.status === "active");
        setPositions(rows);
      })
      .catch((e) => live && setError(cleanError(e)));
    return () => {
      live = false;
    };
  }, [ringUrl, tick, refresh]);

  async function deposit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy("deposit");
    try {
      const res = await authedFetch(ringUrl, "/v1/strategies/earn/deposit", {
        amountMicro: usdcToMicro(depositAmount).toString(),
        fromParty: desk,
      });
      if (res.status === "pending_approval") {
        setNotice(`Routed to approver — four-eyes (approval #${res.approvalId})`);
      } else {
        setNotice(
          "Deposited — principal sealed into a private StrategyPosition note and deployed to Privy Earn on Base",
        );
        setDepositAmount("");
      }
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusy(null);
    }
  }

  async function redeem(cid: string) {
    setError(null);
    setNotice(null);
    setBusy(cid);
    try {
      const res = await authedFetch(ringUrl, "/v1/strategies/earn/withdraw", { positionCid: cid });
      if (res.status === "pending_approval") {
        setNotice(`Routed to approver — four-eyes (approval #${res.approvalId})`);
      } else if (res.status === "pending_redeem") {
        setNotice("Privy Earn withdrawal completed; private note burn is pending retry");
      } else {
        setNotice(
          "Redeemed — pulled from Privy Earn and the position note burned; principal returned to your desk as shielded cash",
        );
      }
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusy(null);
    }
  }

  const earn = data?.earn;
  const roadmap = data?.roadmap.privateStrategies;

  return (
    <div className="px-8 py-6 max-w-[1180px] space-y-6">
      <div>
        <div className="page-eyebrow">Strategies</div>
        <h1 className="page-title">Strategies</h1>
      </div>
      {error && <p className="err">{error}</p>}

      {!data ? (
        <p className="text-sm text-ink-5">Loading…</p>
      ) : (
        <div className="flex flex-wrap items-start gap-6">
          <section className="card w-full max-w-md space-y-4">
            <div>
              <span className="rounded-md border border-gold/40 bg-gold/5 px-1.5 py-0.5 text-[9.5px] font-medium tracking-[0.08em] text-gold-deep uppercase">
                Private · live
              </span>
              <h2 className="section-title mt-1.5">
                Private yield — Privy Earn (Gauntlet USDC Prime · Morpho, Base)
              </h2>
              <p className="mt-1 text-[11px] text-ink-5">
                Cash is deployed through a private note, so the position isn&apos;t linkable to your institution on-chain.
              </p>
            </div>

            {!earn?.enabled ? (
              <p className="text-sm text-ink-5">
                Earn not configured on this Ring.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-ink-5">In vault</p>
                    <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">
                      {fmtMicro(earn.position?.assetsInVault)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-5">Deployed · shielded principal</p>
                    <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">
                      {fmtMicro(data.deployedMicro)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-ink-6">
                      The public chain sees the deposit amount, but not who it came from.
                    </p>
                  </div>
                </div>

                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-ink-5">Earned yield</dt>
                    <dd className="mt-0.5 tabular-nums text-pos">
                      {fmtMicro(earn.position?.earnedYield)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-5">APY</dt>
                    <dd className="mt-0.5 tabular-nums text-ink-2">
                      {earn.vault ? `${earn.vault.apyBps / 100}%` : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-5">Vault TVL</dt>
                    <dd className="mt-0.5 tabular-nums text-ink-2">
                      {earn.vault
                        ? `$${Number(earn.vault.tvlUsd).toLocaleString()}`
                        : "—"}
                    </dd>
                  </div>
                </dl>

                <div>
                  <label className="label" htmlFor="desk">Desk (cash source / destination)</label>
                  <input
                    id="desk"
                    className="input w-full"
                    placeholder="treasury"
                    value={desk}
                    onChange={(e) => setDesk(e.target.value)}
                  />
                </div>

                <form
                  className="flex items-end gap-2"
                  onSubmit={deposit}
                >
                  <div className="flex-1">
                    <label className="label" htmlFor="deposit">
                      Deposit (USDC)
                    </label>
                    <input
                      id="deposit"
                      className="input w-full"
                      placeholder="10000.00"
                      inputMode="decimal"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={busy !== null || !depositAmount.trim()}
                  >
                    {busy === "deposit" ? "Submitting…" : "Deposit"}
                  </button>
                </form>

                <div>
                  <div className="label">Open positions — redeem to unwind</div>
                  {positions.length === 0 ? (
                    <p className="text-[12px] text-ink-5">No open strategy positions.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {positions.map((p) => (
                        <li
                          key={p.cid}
                          className="flex items-center justify-between gap-2 rounded-lg border border-line-soft bg-ground px-3 py-2"
                        >
                          <span className="flex items-center gap-2">
                            <HashChip value={p.cid} />
                            <span className="tabular-nums text-[13px] text-ink">
                              {fmtMicro(p.amount_micro)}
                            </span>
                          </span>
                          <button
                            type="button"
                            className="btn"
                            disabled={busy !== null}
                            onClick={() => redeem(p.cid)}
                          >
                            {busy === p.cid ? "Redeeming…" : "Redeem"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {notice && <p className="text-sm text-gold-deep">{notice}</p>}
              </>
            )}
          </section>

          {/* Roadmap teaser — the one honest grey, beside the live Earn card. */}
          <RoadmapBox
            title={`${roadmap?.title ?? "Private strategies"} — soon`}
            className="w-full max-w-md"
          >
            <p>{roadmap?.blurb}</p>
            <div className="mt-3 flex gap-2">
              <button className="btn" disabled>
                Morpho
              </button>
              <button className="btn" disabled>
                Aave
              </button>
              <button className="btn" disabled>
                Uniswap
              </button>
            </div>
          </RoadmapBox>
        </div>
      )}
    </div>
  );
}
