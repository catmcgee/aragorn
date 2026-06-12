"use client";

// Roadmap module previews (PLAN §6): one paragraph of what the module *will*
// do, in desk language, plus its intended components as honestly grey boxes.
// Never a dead click, never ambiguity about what works.

import Link from "next/link";
import { useParams } from "next/navigation";
import RoadmapBox, { RoadmapBadge, SkeletonRows } from "@/components/RoadmapBox";

interface Preview {
  name: string;
  lede: string;
  intent: string;
  boxes: { title: string; desc: string; widths: number[] }[];
}

const PREVIEWS: Record<string, Preview> = {
  lending: {
    name: "Lending",
    lede: "Open-term securities lending — loan blotter, recall queue, rerate panel.",
    intent:
      "Lend idle bond inventory open-term against cash collateral. The desk works a loan blotter with rerate and recall controls; borrowers post margin, rerates apply next-day, and recalls settle DvP inside the Ring — none of it visible off-ledger. Same notes, same proofs, one new template.",
    boxes: [
      { title: "Loan blotter", desc: "Open loans, rerates and recalls in one running view.", widths: [84, 66, 75] },
      { title: "Recall queue", desc: "Recalls issued and inbound, with settlement deadlines.", widths: [72, 58] },
      { title: "Rerate panel", desc: "Reprice open loans; changes apply next-day.", widths: [78, 64, 52] },
    ],
  },
  fx: {
    name: "FX",
    lede: "Intraday FX swaps, PvP atomic on both legs — swap ticket, pairs board.",
    intent:
      "Intraday FX swaps settled payment-versus-payment: both currency legs commit atomically or not at all, so there is no Herstatt window. A swap ticket books the near and far legs in a single action; the pairs board streams executable levels from whitelisted counterparties.",
    boxes: [
      { title: "Swap ticket", desc: "Book near and far legs in one atomic action.", widths: [80, 62, 70] },
      { title: "Pairs board", desc: "Streaming levels from whitelisted counterparties.", widths: [74, 86, 60] },
    ],
  },
  compliance: {
    name: "Compliance",
    lede: "Screening status, association sets, viewing-key grants, disclosure queue.",
    intent:
      "Screening and disclosure without breaking privacy. Counterparties prove membership in clean association sets at the shield; viewing-key grants give a regulator scoped, read-only sight of exactly the contracts in question; every disclosure is queued, approved four-eyes, and logged.",
    boxes: [
      { title: "Screening status", desc: "Counterparty and association-set checks at the shield.", widths: [76, 60] },
      { title: "Viewing-key grants", desc: "Scoped, revocable read access for regulators.", widths: [82, 68, 54] },
      { title: "Disclosure queue", desc: "Pending disclosures — four-eyes approved, fully logged.", widths: [70, 84] },
    ],
  },
  reports: {
    name: "Reports",
    lede: "Report builder, scheduled exports, reconciliation certificates pinned to L1.",
    intent:
      "Reconciliation and reporting built on the audit trail. Compose extracts in the report builder, schedule exports to your books-and-records system, and pin reconciliation certificates to L1 so any third party can verify the report matches the chain.",
    boxes: [
      { title: "Report builder", desc: "Compose extracts over the decrypted record.", widths: [80, 66, 72] },
      { title: "Scheduled exports", desc: "Push to books-and-records on a schedule.", widths: [62, 78] },
      { title: "Reconciliation certificates", desc: "Pinned to L1 — verifiable by anyone.", widths: [74, 58, 68] },
    ],
  },
};

export default function RoadmapModulePage() {
  const params = useParams<{ module: string }>();
  const preview = PREVIEWS[params.module];

  if (!preview) {
    return (
      <div className="max-w-xl space-y-3">
        <h1 className="page-title">Unknown module</h1>
        <p className="text-sm text-slate-400">
          No preview for “{params.module}”.{" "}
          <Link href="/settings" className="text-gold hover:text-gold-bright">
            Back to Settings → Features
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="page-title">{preview.name}</h1>
          <RoadmapBadge />
        </div>
        <p className="page-caption">{preview.lede}</p>
      </div>

      <p className="max-w-2xl text-sm leading-relaxed text-slate-400">
        {preview.intent}
      </p>

      <div className="grid grid-cols-2 gap-4">
        {preview.boxes.map((b) => (
          <RoadmapBox key={b.title} title={b.title}>
            <p>{b.desc}</p>
            <SkeletonRows widths={b.widths} />
          </RoadmapBox>
        ))}
      </div>

      <p className="text-[11px] text-slate-600">
        Designed, not yet shipped — see EXPLORATION.md. Toggle this module off in{" "}
        <Link href="/settings" className="text-slate-400 hover:text-slate-200">
          Settings → Features
        </Link>{" "}
        to remove it from the nav.
      </p>
    </div>
  );
}
