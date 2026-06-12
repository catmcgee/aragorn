"use client";

// "What the world sees" — the unauthenticated public feed. Every settlement
// renders as a featureless gray ring + circuit id + tx hash: the public sees
// rings, never what's inside them. (SSE wiring deliberately untouched.)

import { useEffect, useState } from "react";
import { GrayRing } from "./rings";
import { HashChip } from "./chips";

interface FeedRow {
  type?: string;
  circuit?: number | string;
  circuitId?: number | string;
  tx?: string;
  txid?: string;
  status?: string;
  [k: string]: unknown;
}

export default function PublicFeed({ ringUrl }: { ringUrl: string }) {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [state, setState] = useState<"connecting" | "open" | "error">("connecting");

  useEffect(() => {
    const es = new EventSource(`${ringUrl}/public-feed`);
    es.onopen = () => setState("open");
    es.onerror = () => setState("error");
    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as FeedRow;
        setRows((r) => [e, ...r].slice(0, 200));
      } catch {
        // ignore malformed frames
      }
    };
    return () => es.close();
  }, [ringUrl]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <p className="mb-3 text-xs text-slate-500">
        Unauthenticated feed — featureless commitments only. No parties, no
        amounts, no terms.
        {state === "error" && " (disconnected — retrying)"}
        {state === "connecting" && " (connecting…)"}
      </p>
      <div className="flex-1 space-y-1 overflow-y-auto">
        {rows.length === 0 && (
          <p className="text-sm text-slate-600">No public events yet.</p>
        )}
        {rows.map((e, i) => {
          const tx =
            typeof e.tx === "string" ? e.tx : typeof e.txid === "string" ? e.txid : null;
          return (
            <div
              key={i}
              className="flex items-center gap-2 rounded-sm border border-white/5 bg-slate-950/60 px-2 py-1.5"
            >
              <GrayRing size={16} />
              <span className="text-xs text-slate-400">{e.type ?? "settlement"}</span>
              <span className="chip">circuit #{String(e.circuit ?? e.circuitId ?? "?")}</span>
              <HashChip value={tx} />
              <span className="ml-auto text-[11px] text-slate-500">
                {e.status ?? "committed"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
