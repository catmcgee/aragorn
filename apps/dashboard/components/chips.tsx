"use client";

// No hex anywhere user-facing by default (PLAN §6.2): cids/txids render as
// short monospace chips — first 8 chars + … — that reveal on first click and
// copy the full value on the second. Parties render as desk names: the org is
// implied, so "UBS::treasury" reads as "Treasury"; ENS names stay full.

import { useContext, useState } from "react";
import { RingContext } from "@/lib/ring";

const TX_RE = /^0x[0-9a-fA-F]{64}$/;

export function HashChip({
  value,
  className = "",
  kind = "tx",
}: {
  value?: string | null;
  className?: string;
  /** "tx" → /tx/<hash>, "address" → /address/<hash> on the explorer (when configured). */
  kind?: "tx" | "address";
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const explorer = useContext(RingContext)?.me.explorerBase ?? null;

  if (!value) return <span className="text-ink-6">—</span>;
  // On a public chain (Sepolia), a tx hash links out to the block explorer — the data
  // is genuinely live and verifiable. Locally there's no explorer, so no link.
  const href = explorer && TX_RE.test(value) ? `${explorer}/${kind}/${value}` : null;

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
          <span className="text-ink-6">…</span>
        </>
      )}
      {revealed && href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-steel hover:underline"
          title="View on Etherscan"
        >
          ↗
        </a>
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
  if (!party) return <span className="text-ink-6">—</span>;
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
