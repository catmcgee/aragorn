"use client";

// No hex anywhere user-facing by default (PLAN §6.2): cids/txids render as
// short monospace chips — first 8 chars + … — and never reveal/copy the full
// value. Parties render as desk names: the org is implied, so "UBS::treasury"
// reads as "Treasury"; ENS names stay full.

import { useContext } from "react";
import { RingContext } from "@/lib/ring";

const TX_RE = /^0x[0-9a-fA-F]{64}$/;

export function HashChip({
  value,
  className = "",
  kind = "cid",
}: {
  value?: string | null;
  className?: string;
  /** "tx" → /tx/<hash>, "address" → /address/<hash> on the explorer (when configured).
   *  "cid" (default) is a note commitment / contract id — NOT a transaction, so it never
   *  links out (a commitment hash isn't queryable on Etherscan; /tx/<cid> would 404). */
  kind?: "tx" | "address" | "cid";
}) {
  const explorer = useContext(RingContext)?.me.explorerBase ?? null;

  if (!value) return <span className="text-ink-6">—</span>;
  // We never show the full value in the UI and never copy/expand it. On a public chain a tx
  // hash / address links out to the block explorer (the only action); commitment ids (kind
  // "cid") aren't transactions, and locally there's no explorer, so those render as static
  // truncated text.
  const href = explorer && kind !== "cid" && TX_RE.test(value) ? `${explorer}/${kind}/${value}` : null;
  const short = (
    <>
      {value.slice(0, 8)}
      <span className="text-ink-6">…</span>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={`chip ${className}`}
        title="View on Etherscan"
      >
        {short}
        <span className="text-steel">↗</span>
      </a>
    );
  }
  return <span className={`chip ${className}`}>{short}</span>;
}

/** A settlement note: a human label followed by its tx hash as a linked chip
 *  (→ "View on Etherscan" when on a public chain). Use anywhere a flow reports a txid. */
export function TxNote({
  label,
  txid,
  className = "",
}: {
  label: string;
  txid?: string | null;
  className?: string;
}) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {label}
      {txid ? <HashChip value={txid} kind="tx" /> : null}
    </span>
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
