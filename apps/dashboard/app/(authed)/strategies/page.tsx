"use client";

// Strategies — treasury yield. Earn deposits route idle USDC into the Gauntlet
// USDC Prime vault (Morpho, Base) via Privy; private strategies are roadmap.
// The strategies endpoints are not in @aragorn/sdk yet, so raw authed fetch.

import { useEffect, useState } from "react";
import { cleanError } from "@aragorn/sdk";
import { useRing, getStoredToken } from "@/lib/ring";
import { fmtMicro, usdcToMicro } from "@/lib/format";
import RoadmapBox from "@/components/RoadmapBox";

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
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [busy, setBusy] = useState<"deposit" | "withdraw" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    authedFetch(ringUrl, "/v1/strategies")
      .then((r) => live && setData(r as unknown as Strategies))
      .catch((e) => live && setError(cleanError(e)));
    return () => {
      live = false;
    };
  }, [ringUrl, tick, refresh]);

  async function earnAction(kind: "deposit" | "withdraw", e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(kind);
    try {
      const amount = kind === "deposit" ? depositAmount : withdrawAmount;
      await authedFetch(ringUrl, `/v1/strategies/earn/${kind}`, {
        amountMicro: usdcToMicro(amount).toString(),
      });
      setNotice(
        `${kind === "deposit" ? "Deposit" : "Withdrawal"} submitted — settling on Base`,
      );
      if (kind === "deposit") setDepositAmount("");
      else setWithdrawAmount("");
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
            <h2 className="section-title">
              Privy Earn — Gauntlet USDC Prime (Morpho, Base)
            </h2>

            {!earn?.enabled ? (
              <p className="text-sm text-ink-5">
                Earn not configured on this Ring.
              </p>
            ) : (
              <>
                <div>
                  <p className="text-xs text-ink-5">In vault</p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">
                    {fmtMicro(earn.position?.assetsInVault)}
                  </p>
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

                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => earnAction("deposit", e)}
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

                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => earnAction("withdraw", e)}
                >
                  <div className="flex-1">
                    <label className="label" htmlFor="withdraw">
                      Withdraw (USDC)
                    </label>
                    <input
                      id="withdraw"
                      className="input w-full"
                      placeholder="10000.00"
                      inputMode="decimal"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn"
                    disabled={busy !== null || !withdrawAmount.trim()}
                  >
                    {busy === "withdraw" ? "Submitting…" : "Withdraw"}
                  </button>
                </form>

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
