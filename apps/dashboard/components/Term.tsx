// Desk vocabulary with a hover glossary (PLAN §6: "speak desk, deliberately").
// Dotted underline → one-line definition. Rendered through a portal with viewport
// clamping so the tooltip is never clipped by a scroll container or hidden behind
// the sidebar (a pure-CSS ::after can't escape an `overflow` ancestor).
"use client";

import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

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

// Half the tooltip's max width (17rem ≈ 272px) plus an 8px viewport margin — used to
// clamp the centered tooltip so it never spills off the left or right edge.
const EDGE_MARGIN = 144;

export default function Term({
  t,
  children,
  className = "",
}: {
  t: TermKey;
  children?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);

  function show() {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const max = window.innerWidth - EDGE_MARGIN;
    // Flip below the term when there isn't room above (term near the top of the viewport),
    // otherwise the tooltip clips off the top / into the browser chrome.
    const below = r.top < 96;
    setPos({
      x: Math.min(Math.max(r.left + r.width / 2, EDGE_MARGIN), max),
      y: below ? r.bottom + 8 : r.top - 8,
      below,
    });
  }
  const hide = () => setPos(null);

  return (
    <>
      <span
        ref={ref}
        className={`term ${className}`}
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children ?? t}
      </span>
      {pos &&
        createPortal(
          <span
            role="tooltip"
            className="term-tip"
            style={{
              left: pos.x,
              top: pos.y,
              transform: pos.below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
            }}
          >
            {GLOSSARY[t]}
          </span>,
          document.body,
        )}
    </>
  );
}
