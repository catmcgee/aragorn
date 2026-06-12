"use client";

// Strategies — treasury yield. Earn deposits route idle USDC into the Gauntlet
// USDC Prime vault (Morpho, Base) via Privy; private strategies are roadmap.
// The strategies endpoints are not in @aragorn/sdk yet, so raw authed fetch.

import { useEffect, useState } from "react";
import { useRing, getStoredToken } from "@/lib/ring";
import { fmtMicro, usdcToMicro } from "@/lib/format";

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
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const earn = data?.earn;
  const roadmap = data?.roadmap.privateStrategies;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-100">Strategies</h1>
      {error && <p className="err">{error}</p>}

      {!data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="flex flex-wrap items-start gap-6">
          <section className="card w-full max-w-md space-y-4">
            <h2 className="section-title">
              Privy Earn — Gauntlet USDC Prime (Morpho, Base)
            </h2>

            {!earn?.enabled ? (
              <p className="text-sm text-slate-500">
                Earn not configured on this Ring.
              </p>
            ) : (
              <>
                <div>
                  <p className="text-xs text-slate-400">In vault</p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-100">
                    {fmtMicro(earn.position?.assetsInVault)}
                  </p>
                </div>

                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-400">Earned yield</dt>
                    <dd className="mt-0.5 tabular-nums text-emerald-400">
                      {fmtMicro(earn.position?.earnedYield)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">APY</dt>
                    <dd className="mt-0.5 tabular-nums text-slate-200">
                      {earn.vault ? `${earn.vault.apyBps / 100}%` : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Vault TVL</dt>
                    <dd className="mt-0.5 tabular-nums text-slate-200">
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

                {notice && <p className="text-sm text-amber-400">{notice}</p>}
              </>
            )}
          </section>

          {/* Intentionally muted: roadmap teaser, not an active product surface. */}
          <section className="card w-full max-w-md space-y-4 opacity-50">
            <div className="flex items-center justify-between">
              <h2 className="section-title mb-0">
                {roadmap?.title ?? "Private strategies"} — Roadmap
              </h2>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                Roadmap
              </span>
            </div>
            <p className="text-sm text-slate-400">{roadmap?.blurb}</p>
            <div className="flex gap-2">
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
          </section>
        </div>
      )}
    </div>
  );
}
