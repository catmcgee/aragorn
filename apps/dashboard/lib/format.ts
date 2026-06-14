// Amount helpers. Amounts arrive as micro-USDC strings; keep them BigInt-safe.

const MICRO = 1_000_000n;

/** "1234560000" -> "$1,234.56". Display-only formatting; never round-trips through Number. */
export function fmtMicro(micro: string | null | undefined): string {
  if (micro === null || micro === undefined || micro === "") return "—";
  let v: bigint;
  try {
    v = BigInt(micro);
  } catch {
    return micro;
  }
  const neg = v < 0n;
  if (neg) v = -v;
  const whole = (v / MICRO).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = ((v % MICRO) / 10_000n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}$${whole}.${cents}`;
}

/** "1234.56" (USDC) -> 1234560000n (micro). Throws on bad input. */
export function usdcToMicro(input: string): bigint {
  const s = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) {
    throw new Error("Invalid amount — use up to 6 decimal places");
  }
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * MICRO + BigInt(frac.padEnd(6, "0") || "0");
}

export function shortHex(s: string | null | undefined, n = 10): string {
  if (!s) return "—";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export const TEMPLATE_NAMES: Record<number, string> = {
  1: "Cash",
  2: "Bond Position",
  3: "Repo Proposal",
  4: "Collateral Allocation",
  5: "Repo Agreement",
  6: "Entitlement",
  7: "Strategy Position",
};

export const STATUS_DOT: Record<string, string> = {
  active: "bg-emerald-500",
  pending_consume: "bg-amber-500",
  consumed: "bg-slate-500",
};
