// The ring vocabulary (PLAN §6.2) — all of Aragorn's playfulness lives here.
//
//   BorromeanMark   logo: three interlocked rings — cut any one and all three
//                   fall apart, which is literally atomic DvP.
//   SettlementRing  lifecycle as ring geometry: in-flight = animated arc,
//                   committed = ¾ circle, final = closed circle,
//                   consumed = featureless gray ring.
//   ApprovalRing    four-eyes: two half-rings that join into a circle when the
//                   second signature lands.
//   LockRing        encumbered position: a ring with an inner lock band.
//   GrayRing        what the public sees — a ring, never what's inside it.
//   ProgressRing    a ring closing as a fraction completes (My Pay proving).

const GOLD = "#b08833";
const GOLD_BRIGHT = "#c79a3e";
const GRAY = "#9aa0a8";

export function BorromeanMark({
  size = 30,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  // The brand mark from Aragorn.dc.html: three plain gold rings in a triangle.
  const sw = (1.7 * 30) / size + (size >= 30 ? 0 : 0); // keep stroke optically even
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 30 30"
      className={className}
      role="img"
      aria-label="Aragorn — three interlocked rings"
    >
      <circle cx="11.5" cy="11.5" r="7.4" fill="none" stroke={GOLD} strokeWidth="1.7" />
      <circle cx="18.5" cy="11.5" r="7.4" fill="none" stroke={GOLD} strokeWidth="1.7" />
      <circle cx="15" cy="18" r="7.4" fill="none" stroke={GOLD} strokeWidth="1.7" />
    </svg>
  );
}

export type SettlementState = "inflight" | "committed" | "final" | "consumed";

export function SettlementRing({
  state,
  size = 14,
  className = "",
  title,
}: {
  state: SettlementState;
  size?: number;
  className?: string;
  title?: string;
}) {
  const dash =
    state === "inflight" ? "30 70" : state === "committed" ? "75 25" : "100 0";
  const stroke = state === "consumed" ? GRAY : GOLD;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={`inline-block shrink-0 ${className}`}
      role="img"
      aria-label={title ?? state}
    >
      {title ? <title>{title}</title> : null}
      <g className={state === "inflight" ? "ring-orbit" : undefined}>
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke={stroke}
          strokeWidth="1.6"
          pathLength={100}
          strokeDasharray={state === "consumed" ? undefined : dash}
          strokeLinecap="round"
          transform="rotate(-90 8 8)"
        />
      </g>
    </svg>
  );
}

export function ProgressRing({
  fraction,
  spinning = false,
  size = 18,
  className = "",
}: {
  /** 0..1 — how much of the ring has closed. */
  fraction: number;
  spinning?: boolean;
  size?: number;
  className?: string;
}) {
  const pct = Math.max(2, Math.min(100, Math.round(fraction * 100)));
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={`inline-block shrink-0 ${className}`}
      aria-hidden
    >
      <circle cx="8" cy="8" r="6" fill="none" stroke="rgb(23 32 42 / 0.1)" strokeWidth="1.6" />
      <g className={spinning ? "ring-orbit" : undefined}>
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke={GOLD}
          strokeWidth="1.6"
          pathLength={100}
          strokeDasharray={`${pct} ${100 - pct}`}
          strokeLinecap="round"
          transform="rotate(-90 8 8)"
          style={{ transition: "stroke-dasharray 400ms ease" }}
        />
      </g>
    </svg>
  );
}

export function ApprovalRing({
  status,
  size = 15,
  className = "",
}: {
  status: "pending" | "approved" | "rejected";
  size?: number;
  className?: string;
}) {
  // Two half-rings: the requester's half is always drawn solid; the approver's
  // half is hollow until they sign — then the circle closes.
  const right = "M 8 1.8 A 6.2 6.2 0 0 1 8 14.2"; // requester
  const left = "M 8 14.2 A 6.2 6.2 0 0 1 8 1.8"; // approver
  const stroke = status === "rejected" ? "#c46a64" : GOLD;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={`inline-block shrink-0 ${className}`}
      role="img"
      aria-label={`four-eyes ${status}`}
    >
      <path d={right} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
      <path
        d={left}
        fill="none"
        stroke={status === "pending" ? "rgb(201 168 76 / 0.35)" : stroke}
        strokeWidth={status === "pending" ? 1.2 : 1.6}
        strokeLinecap="round"
        strokeDasharray={status === "pending" ? "2 2.6" : undefined}
        opacity={status === "rejected" ? 0.45 : 1}
      />
    </svg>
  );
}

export function LockRing({
  size = 15,
  className = "",
  title = "encumbered",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={`inline-block shrink-0 ${className}`}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <circle cx="8" cy="8" r="6.2" fill="none" stroke={GOLD} strokeWidth="1.4" />
      {/* the inner lock band */}
      <circle cx="8" cy="8" r="3.4" fill="none" stroke={GOLD} strokeWidth="1" opacity="0.75" />
    </svg>
  );
}

export function GrayRing({
  size = 16,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={`inline-block shrink-0 ${className}`}
      aria-hidden
    >
      <circle cx="8" cy="8" r="6" fill="none" stroke="#9aa0a8" strokeWidth="1.5" />
    </svg>
  );
}

/** Plain filled-stroke ring used as an entry button glyph (login). */
export function RingGlyph({
  size = 22,
  color = GOLD,
  className = "",
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden>
      <circle cx="8" cy="8" r="5.6" fill="none" stroke={color} strokeWidth="1.8" />
    </svg>
  );
}
