"use client";

// "Public view" drawer — what an outside observer sees. Unauthenticated SSE.

import { useEffect, useState } from "react";
import { shortHex } from "@/lib/format";

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
    <div className="flex h-full flex-col">
      <p className="mb-3 text-xs text-slate-500">
        Unauthenticated public feed — this is everything the world can see.
        {state === "error" && " (disconnected — retrying)"}
        {state === "connecting" && " (connecting…)"}
      </p>
      <div className="flex-1 space-y-1 overflow-y-auto">
        {rows.length === 0 && <p className="text-sm text-slate-600">No public events yet.</p>}
        {rows.map((e, i) => (
          <div
            key={i}
            className="rounded border border-slate-800 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-400"
          >
            {e.type ?? "settlement"} · circuit #{String(e.circuit ?? e.circuitId ?? "?")} · tx{" "}
            {shortHex(typeof e.tx === "string" ? e.tx : typeof e.txid === "string" ? e.txid : null)}{" "}
            · {e.status ?? "committed"}
          </div>
        ))}
      </div>
    </div>
  );
}
