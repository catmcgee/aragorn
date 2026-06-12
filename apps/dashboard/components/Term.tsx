// Desk vocabulary with a hover glossary (PLAN §6: "speak desk, deliberately").
// Dotted underline → one-line definition in 200ms. CSS only, no library.

import type { ReactNode } from "react";

const GLOSSARY = {
  blotter: "The desk's running record of trades — every booking, live and closed.",
  DvP: "Delivery-versus-payment: the security and the cash move atomically — both legs settle, or neither does.",
  "on-leg": "The opening leg of a repo: collateral goes out, cash comes in.",
  "off-leg": "The closing leg: cash plus interest returns, collateral comes back.",
  encumbered: "Pledged under a governing agreement — cannot move until the agreement releases it.",
  allocation: "The specific positions pledged to satisfy a collateral obligation.",
  "term sheet": "The economics of the trade: principal, rate, term, day count.",
  haircut: "Discount applied to collateral value to protect the cash lender.",
  "ACT/360": "Day-count convention: actual days elapsed over a 360-day year.",
  registrar: "Keeper of the issuer's holder ledger — who owns what, officially.",
  "settlement finality": "The moment a transfer becomes irrevocable on the ledger.",
  "four-eyes": "Two people must sign: the requester and an independent approver.",
  notional: "The face value of the trade, before any haircut.",
} as const;

export type TermKey = keyof typeof GLOSSARY;

export default function Term({
  t,
  children,
  className = "",
}: {
  t: TermKey;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span className={`tip term ${className}`} data-tip={GLOSSARY[t]}>
      {children ?? t}
    </span>
  );
}
