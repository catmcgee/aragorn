// The one honest grey (PLAN §6): everything designed-but-not-shipped renders
// through this — muted box, gold-outline "Roadmap" badge, never a dead click.

import type { ReactNode } from "react";

export function RoadmapBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`tip badge-roadmap ${className}`}
      data-tip="Designed, not yet shipped — see EXPLORATION.md"
    >
      Roadmap
    </span>
  );
}

export default function RoadmapBox({
  title,
  children,
  className = "",
}: {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`roadmap-box ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
          {title}
        </h3>
        <RoadmapBadge />
      </div>
      {children && <div className="mt-3 text-sm text-slate-500">{children}</div>}
    </section>
  );
}

/** Decorative skeleton rows for roadmap previews — suggests the UI to come. */
export function SkeletonRows({ widths = [82, 64, 73] }: { widths?: number[] }) {
  return (
    <div className="mt-3 space-y-1.5" aria-hidden>
      {widths.map((w, i) => (
        <div key={i} className="h-1.5 rounded-full bg-white/[0.05]" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}
