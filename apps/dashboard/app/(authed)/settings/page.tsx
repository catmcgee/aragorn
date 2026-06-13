"use client";

// Settings → Features — the module model made visible (PLAN §6): a Ring is
// core + modules, and the admin composes it here. Roadmap modules toggle on to
// reveal their preview pages in the nav. The settings endpoints are not in
// @aragorn/sdk yet, so raw authed fetch (same pattern as Repo / Payroll).

import { useCallback, useEffect, useState } from "react";
import { cleanError } from "@aragorn/sdk";
import { useRing, getStoredToken } from "@/lib/ring";
import RoadmapBox, { RoadmapBadge } from "@/components/RoadmapBox";
import { SettlementRing } from "@/components/rings";

interface ModuleRow {
  key: string;
  status: "live" | "partial" | "roadmap";
  enabled: boolean;
}

const MODULE_META: Record<string, { name: string; desc: string }> = {
  payments: {
    name: "Payments",
    desc: "Internal department transfers and Ring-to-Ring settlement.",
  },
  repo: {
    name: "Repo",
    desc: "Bilateral repo against bond collateral — settlement is atomic DvP.",
  },
  payroll: {
    name: "Payroll",
    desc: "Private salary entitlements, claimed in-browser with a ZK proof.",
  },
  issuance: {
    name: "Issuance",
    desc: "The Registry — terms and holder ledger; issue / DvP / coupon to come.",
  },
  strategies: {
    name: "Strategies",
    desc: "Treasury yield on idle cash via Privy Earn.",
  },
  lending: {
    name: "Lending",
    desc: "Open-term securities lending — loan blotter, recall queue, rerate panel.",
  },
  fx: {
    name: "FX",
    desc: "Intraday FX swaps, PvP atomic on both legs — swap ticket, pairs board.",
  },
  compliance: {
    name: "Compliance",
    desc: "Screening status, association sets, viewing-key grants, disclosure queue.",
  },
  reports: {
    name: "Reports",
    desc: "Report builder, scheduled exports, reconciliation certificates pinned to L1.",
  },
};

async function settingsFetch(
  ringUrl: string,
  method: "GET" | "PUT",
  body?: unknown,
): Promise<Record<string, unknown>> {
  const token = getStoredToken();
  const res = await fetch(`${ringUrl}/v1/settings/modules`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((json.error as string) ?? `HTTP ${res.status}`);
  return json;
}

export default function SettingsPage() {
  const { me, ringUrl, refreshMe } = useRing();
  const [modules, setModules] = useState<ModuleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(() => {
    settingsFetch(ringUrl, "GET")
      .then((r) => setModules((r.modules as ModuleRow[]) ?? []))
      .catch((e) => setError(cleanError(e)));
  }, [ringUrl]);

  useEffect(() => {
    load();
  }, [load]);

  if (!me.capabilities.includes("admin")) {
    return <p className="px-8 py-6 text-sm text-ink-5">Settings are admin-only.</p>;
  }

  async function toggle(m: ModuleRow) {
    setError(null);
    setBusyKey(m.key);
    try {
      await settingsFetch(ringUrl, "PUT", { module: m.key, enabled: !m.enabled });
      load();
      await refreshMe(); // reveal/hide the module's nav item immediately
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="px-8 py-6 max-w-3xl space-y-6">
      <div className="mb-1">
        <div className="page-eyebrow">Settings</div>
        <h1 className="page-title">Settings</h1>
        <p className="page-caption">
          A Ring is core + modules. Compose yours from the businesses you run.
        </p>
      </div>
      {error && <p className="err">{error}</p>}

      <section className="card">
        <h2 className="section-title">Features</h2>
        {!modules ? (
          <p className="text-sm text-ink-5">Loading…</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {modules.map((m) => {
              const meta = MODULE_META[m.key] ?? { name: m.key, desc: "" };
              return (
                <li key={m.key} className="flex items-center gap-4 py-3">
                  <SettlementRing
                    state={
                      m.status === "live"
                        ? "final"
                        : m.status === "partial"
                          ? "committed"
                          : "consumed"
                    }
                    size={15}
                    title={m.status}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink">
                        {meta.name}
                      </span>
                      {m.status === "roadmap" && <RoadmapBadge />}
                      {m.status === "partial" && (
                        <span className="rounded-full border border-line px-2 py-0.5 text-[9px] tracking-[0.16em] text-ink-4 uppercase">
                          Flows greyed
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-5">{meta.desc}</p>
                  </div>
                  <Toggle
                    checked={m.enabled}
                    busy={busyKey === m.key}
                    label={`${meta.name} module`}
                    onChange={() => toggle(m)}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-ink-5">
          Toggling a roadmap module on reveals its preview in the nav — what it
          will do, in desk language, with its intended components honestly grey.
        </p>
      </section>

      <RoadmapBox title="Build on Aragorn">
        <p>
          Template SDK — ship your own workflow as a protocol artifact. Circuits
          + payload schema + workflow, published like an ERC: permissionless
          because the math makes it safe, not because anyone vetted it. Roadmap.
        </p>
        <div className="mt-3 flex gap-2">
          <button className="btn" disabled>
            Template SDK docs
          </button>
          <button className="btn" disabled>
            Publish a template
          </button>
        </div>
      </RoadmapBox>

      <div className="grid grid-cols-2 gap-4">
        <RoadmapBox title="FROST quorum">
          Threshold signing for the Ring&apos;s settlement key — t-of-n across
          operator HSMs.
        </RoadmapBox>
        <RoadmapBox title="HSM">
          Hardware-backed custody of note-encryption and viewing keys.
        </RoadmapBox>
        <RoadmapBox title="Safe link">
          Bind the Ring&apos;s funding EOA to a Safe with policy guards.
        </RoadmapBox>
        <RoadmapBox title="Key rotation">
          Rotate org keys without breaking historical viewing-key derivation.
        </RoadmapBox>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  busy,
  label,
  onChange,
}: {
  checked: boolean;
  busy: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={busy}
      onClick={onChange}
      className={`relative h-[18px] w-8 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
        checked ? "border-steel bg-steel" : "border-line bg-ground-2"
      }`}
    >
      <span
        className={`absolute top-[2px] h-3 w-3 rounded-full transition-all ${
          checked ? "left-[16px] bg-white" : "left-[2px] bg-ink-5"
        }`}
      />
    </button>
  );
}
