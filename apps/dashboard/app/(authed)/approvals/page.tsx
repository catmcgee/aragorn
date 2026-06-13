"use client";

import { useEffect, useState } from "react";
import type { Approval } from "@aragorn/sdk";
import { useRing } from "@/lib/ring";
import { fmtMicro } from "@/lib/format";
import { ApprovalRing } from "@/components/rings";

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
    <div className="px-8 py-6 max-w-[1180px]">
      <div className="mb-5">
        <div className="page-eyebrow">Inbox</div>
        <h1 className="page-title">Approvals</h1>
      </div>
      {error && <p className="err">{error}</p>}

      {!approvals ? (
        <p className="text-sm text-ink-5">Loading…</p>
      ) : approvals.length === 0 ? (
        <p className="text-sm text-ink-5">No approvals.</p>
      ) : (
        <div className="space-y-3">
          {approvals.map((a) => (
            <div key={a.id} className="card flex items-start gap-4">
              <ApprovalRing status={a.status} size={20} className="mt-1" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <span className="text-[13px] font-medium text-ink">
                    Approval #{a.id}
                  </span>
                  <span className="text-[13px] tabular-nums text-ink-2">
                    {fmtMicro(a.amount)}
                  </span>
                  <span className="text-[11px] tracking-[0.06em] text-ink-5 uppercase">
                    {a.status}
                  </span>
                </div>
                <div className="mt-1 text-[12px] text-ink-4">
                  Requested by {a.requested_by}
                </div>
                <div className="mt-0.5 font-mono text-[12px] text-ink-3">
                  {workflowParties(a.workflow_state)}
                </div>
                {a.status !== "pending" && a.approver && (
                  <div className="mt-1 text-[11px] text-ink-5">by {a.approver}</div>
                )}
                {outcomes[a.id] && (
                  <p className="mt-1.5 font-mono text-xs text-ink-4">
                    {outcomes[a.id]}
                  </p>
                )}
              </div>
              {a.status === "pending" && (
                <div className="flex shrink-0 gap-2">
                  <button
                    className="btn-primary"
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
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
