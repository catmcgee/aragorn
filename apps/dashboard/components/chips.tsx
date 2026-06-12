"use client";

// No hex anywhere user-facing by default (PLAN §6.2): cids/txids render as
// short monospace chips — first 8 chars + … — that reveal on first click and
// copy the full value on the second. Parties render as desk names: the org is
// implied, so "UBS::treasury" reads as "Treasury"; ENS names stay full.

import { useState } from "react";

export function HashChip({
  value,
  className = "",
}: {
  value?: string | null;
  className?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!value) return <span className="text-slate-600">—</span>;

  async function click() {
    if (!revealed) {
      setRevealed(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(value!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — the value is on screen anyway
    }
  }

  return (
    <button
      type="button"
      className={`chip ${className}`}
      onClick={click}
      title={revealed ? "Click to copy" : "Click to reveal"}
    >
      {revealed ? (
        <span className="break-all whitespace-normal">{value}</span>
      ) : (
        <>
          {value.slice(0, 8)}
          <span className="text-slate-600">…</span>
        </>
      )}
      {copied && <span className="text-gold">copied</span>}
    </button>
  );
}

/** "UBS::treasury" → "Treasury"; ENS names pass through untouched. */
export function partyLabel(party?: string | null): string {
  if (!party) return "—";
  if (party.includes(".")) return party; // ENS — keep full
  const seg = party.includes("::") ? party.split("::").pop()! : party;
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

export function PartyName({
  party,
  className = "",
}: {
  party?: string | null;
  className?: string;
}) {
  if (!party) return <span className="text-slate-600">—</span>;
  const label = partyLabel(party);
  const isEns = party.includes(".");
  return (
    <span
      className={isEns ? `font-mono text-[12px] ${className}` : className}
      title={label === party ? undefined : party}
    >
      {label}
    </span>
  );
}
