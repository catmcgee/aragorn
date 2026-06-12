"use client";

import { useEffect, useState } from "react";
import type { Approval } from "@aragorn/sdk";
import { useRing } from "@/lib/ring";
import { fmtMicro } from "@/lib/format";

const STATUS_COLOR: Record<Approval["status"], string> = {
  pending: "text-amber-400",
  approved: "text-emerald-400",
  rejected: "text-red-400",
};

export default function ApprovalsPage() {
  const { client, tick } = useRing();
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  // last decide outcome per approval id (executed txid or error)
  const [outcomes, setOutcomes] = useState<Record<number, string>>({});
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let live = true;
    client
      .approvals()
      .then((r) => live && setApprovals(r.approvals))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [client, tick, refresh]);

  async function decide(id: number, approve: boolean) {
    setBusyId(id);
    setError(null);
    try {
      const res = await client.decide(id, approve);
      setOutcomes((o) => ({
        ...o,
        [id]: res.txid
          ? `Executed — tx ${res.txid}`
          : approve
            ? "Approved"
            : "Rejected",
      }));
      setRefresh((n) => n + 1);
    } catch (e) {
      setOutcomes((o) => ({
        ...o,
        [id]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusyId(null);
    }
  }

  function workflowParties(ws: Record<string, unknown>): string {
    const from = typeof ws.from === "string" ? ws.from : (ws.fromParty as string) ?? "?";
    const to = typeof ws.to === "string" ? ws.to : (ws.toPartyOrEns as string) ?? (ws.toParty as string) ?? "?";
    return `${from} → ${to}`;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-100">Approvals</h1>
      {error && <p className="err">{error}</p>}

      <section className="card">
        {!approvals ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : approvals.length === 0 ? (
          <p className="text-sm text-slate-500">No approvals.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">#</th>
                <th className="th">Requested by</th>
                <th className="th">Amount</th>
                <th className="th">From → To</th>
                <th className="th">Status</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {approvals.map((a) => (
                <tr key={a.id}>
                  <td className="td tabular-nums">{a.id}</td>
                  <td className="td">{a.requested_by}</td>
                  <td className="td tabular-nums">{fmtMicro(a.amount)}</td>
                  <td className="td font-mono text-xs">{workflowParties(a.workflow_state)}</td>
                  <td className={`td ${STATUS_COLOR[a.status] ?? ""}`}>{a.status}</td>
                  <td className="td">
                    {a.status === "pending" ? (
                      <span className="flex gap-2">
                        <button
                          className="btn"
                          disabled={busyId === a.id}
                          onClick={() => decide(a.id, true)}
                        >
                          Approve
                        </button>
                        <button
                          className="btn"
                          disabled={busyId === a.id}
                          onClick={() => decide(a.id, false)}
                        >
                          Reject
                        </button>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">
                        {a.approver ? `by ${a.approver}` : ""}
                      </span>
                    )}
                    {outcomes[a.id] && (
                      <p className="mt-1 font-mono text-xs text-slate-400">{outcomes[a.id]}</p>
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
