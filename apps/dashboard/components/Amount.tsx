// $X,XXX,XXX.XX with dimmed cents and tabular numerals (PLAN §6.2).
// Formatting stays BigInt-safe via fmtMicro; this only splits for display.

import { fmtMicro } from "@/lib/format";

export default function Amount({
  micro,
  className = "",
}: {
  micro?: string | null;
  className?: string;
}) {
  const s = fmtMicro(micro);
  const dot = s.lastIndexOf(".");
  if (!s.startsWith("$") && !s.startsWith("-$")) {
    return <span className={`tabular-nums ${className}`}>{s}</span>;
  }
  return (
    <span className={`tabular-nums ${className}`}>
      {dot > 0 ? (
        <>
          {s.slice(0, dot)}
          <span className="opacity-45">{s.slice(dot)}</span>
        </>
      ) : (
        s
      )}
    </span>
  );
}
