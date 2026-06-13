"use client";

import { useEffect, useState } from "react";
import type { TransferResult } from "@aragorn/sdk";
import { useRing } from "@/lib/ring";
import { usdcToMicro } from "@/lib/format";
import Term from "@/components/Term";
import { HashChip } from "@/components/chips";
import { ApprovalRing, SettlementRing } from "@/components/rings";

const CUSTOM = "__custom";

export default function TransferPage() {
  const { client, tick } = useRing();
  const [parties, setParties] = useState<string[]>([]);
  const [fromSelect, setFromSelect] = useState<string>(CUSTOM);
  const [fromCustom, setFromCustom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferResult | null>(null);

  useEffect(() => {
    let live = true;
    client
      .portfolio()
      .then((p) => {
        if (!live) return;
        const keys = Object.keys(p.balances);
        setParties(keys);
        setFromSelect((cur) => (cur === CUSTOM && keys.length > 0 ? keys[0] : cur));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [client, tick]);

  const from = fromSelect === CUSTOM ? fromCustom : fromSelect;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const micro = usdcToMicro(amount);
      const res = await client.transfer(from.trim(), to.trim(), micro);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-8 py-6 max-w-lg space-y-6">
      <div>
        <div className="page-eyebrow">Payments</div>
        <h1 className="page-title">Transfer</h1>
        <p className="page-caption">
          Internal department transfers and Ring-to-Ring payments. Over-limit{" "}
          <Term t="notional" /> routes to an approver — <Term t="four-eyes" />.
        </p>
      </div>

      <form className="card space-y-4" onSubmit={submit}>
        <div>
          <label className="label" htmlFor="from">
            From party
          </label>
          {parties.length > 0 ? (
            <select
              id="from"
              className="input w-full"
              value={fromSelect}
              onChange={(e) => setFromSelect(e.target.value)}
            >
              {parties.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value={CUSTOM}>Other…</option>
            </select>
          ) : (
            <input
              id="from"
              className="input w-full"
              placeholder="UBS::trading"
              value={fromCustom}
              onChange={(e) => setFromCustom(e.target.value)}
            />
          )}
          {parties.length > 0 && fromSelect === CUSTOM && (
            <input
              className="input mt-2 w-full"
              placeholder="UBS::trading"
              value={fromCustom}
              onChange={(e) => setFromCustom(e.target.value)}
            />
          )}
        </div>

        <div>
          <label className="label" htmlFor="to">
            To
          </label>
          <input
            id="to"
            className="input w-full"
            placeholder="drw.aragorn-rings.eth or UBS::trading"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="amount">
            Amount (USDC)
          </label>
          <input
            id="amount"
            className="input w-full"
            placeholder="1000.00"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <button
          type="submit"
          className="btn-primary"
          disabled={busy || !from.trim() || !to.trim() || !amount.trim()}
        >
          {busy ? "Submitting…" : "Submit transfer"}
        </button>

        {error && <p className="err">{error}</p>}

        {result?.status === "pending_approval" && (
          <p className="flex items-center gap-2 text-sm text-gold-deep">
            <ApprovalRing status="pending" />
            Pending approval #{result.approvalId} — routed to an approver (
            <Term t="four-eyes" />)
          </p>
        )}
        {result?.txid && (
          <p className="flex items-center gap-2 text-sm text-pos">
            <SettlementRing state="final" title="final" />
            Settled — tx <HashChip value={result.txid} />
          </p>
        )}
      </form>
    </div>
  );
}
