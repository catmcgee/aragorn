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
  commitments?: number;
  [k: string]: unknown;
}

export default function PublicFeed({
  ringUrl,
  highlightTx,
}: {
  ringUrl: string;
  highlightTx?: string | null;
}) {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [state, setState] = useState<"connecting" | "open" | "error">("connecting");

  useEffect(() => {
    let live = true;
    // History: the settlements already onchain (featureless summaries), so the panel
    // reflects real activity instead of sitting empty until the next live event.
    fetch(`${ringUrl}/public-events`)
      .then((r) => r.json())
      .then((d: { events?: FeedRow[] }) => {
        if (!live) return;
        setRows((d.events ?? []).map((e) => ({ type: "settlement", ...e })));
      })
      .catch(() => {});
    // Live: new settlements stream in and prepend.
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
    return () => {
      live = false;
      es.close();
    };
  }, [ringUrl]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col px-5 py-4">
      <p className="mb-3 text-xs leading-relaxed text-ink-5">
        Featureless commitments only — no parties, no amounts, no terms. The world
        sees rings, never what&apos;s inside them.
        {state === "error" && " (disconnected — retrying)"}
        {state === "connecting" && " (connecting…)"}
      </p>
      <div className="flex-1 space-y-1 overflow-y-auto">
        {rows.length === 0 && (
          <p className="text-sm text-ink-6">No public events yet.</p>
        )}
        {rows.map((e, i) => {
          const tx =
            typeof e.tx === "string" ? e.tx : typeof e.txid === "string" ? e.txid : null;
          const circuit = e.circuit ?? e.circuitId;
          const isHi = !!highlightTx && !!tx && tx.toLowerCase() === highlightTx.toLowerCase();
          return (
            <div
              key={i}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
                isHi ? "border-gold/60 bg-gold/5" : "border-line-soft bg-ground/60"
              }`}
            >
              <GrayRing size={16} />
              <span className="text-xs text-ink-4">{e.type ?? "settlement"}</span>
              {circuit != null && <span className="chip">circuit #{String(circuit)}</span>}
              {typeof e.commitments === "number" && (
                <span className="chip">
                  {e.commitments} commitment{e.commitments === 1 ? "" : "s"}
                </span>
              )}
              <HashChip value={tx} kind="tx" />
              <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-pos">
                <svg width="11" height="11" viewBox="0 0 16 16">
                  <path
                    d="M4 8.5l2.5 2.5L12 5.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                verified
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
