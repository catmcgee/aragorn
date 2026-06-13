"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Me, RingClient } from "@aragorn/sdk";
import {
  RingContext,
  clearAuth,
  getRingUrl,
  getStoredToken,
  makeClient,
} from "@/lib/ring";
import PublicFeed from "./PublicFeed";
import { BorromeanMark } from "./rings";

// Nav = capability ∩ enabledModules (PLAN §6 module model), grouped into the
// sidebar sections from the Aragorn design. Core pages carry no module key;
// module pages appear only when the admin has the module switched on.
interface NavItem {
  href: string;
  label: string;
  cap: string;
  module?: string;
  roadmap?: boolean;
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: "Essentials",
    items: [
      { href: "/portfolio", label: "Portfolio", cap: "portfolio" },
      { href: "/transfer", label: "Transfer", cap: "transfer", module: "payments" },
      { href: "/repo", label: "Blotter", cap: "repo", module: "repo" },
      { href: "/strategies", label: "Strategies", cap: "strategies", module: "strategies" },
      { href: "/my-pay", label: "My Pay", cap: "my-pay", module: "payroll" },
    ],
  },
  {
    label: "Markets",
    items: [
      { href: "/payroll", label: "Payroll", cap: "payroll", module: "payroll" },
      { href: "/issuance", label: "Registry", cap: "portfolio", module: "issuance" },
      { href: "/roadmap/lending", label: "Lending", cap: "portfolio", module: "lending", roadmap: true },
      { href: "/roadmap/fx", label: "FX", cap: "portfolio", module: "fx", roadmap: true },
    ],
  },
  {
    label: "Governance",
    items: [
      { href: "/approvals", label: "Inbox", cap: "approvals" },
      { href: "/roadmap/compliance", label: "Compliance", cap: "portfolio", module: "compliance", roadmap: true },
      { href: "/roadmap/reports", label: "Reports", cap: "portfolio", module: "reports", roadmap: true },
      { href: "/audit", label: "Audit", cap: "audit" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/admin", label: "Admin", cap: "admin" },
      { href: "/settings", label: "Settings", cap: "admin" },
    ],
  },
];

function initials(email: string): string {
  const name = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  const parts = name.split(" ");
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || email[0]?.toUpperCase() || "·";
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const clientRef = useRef<RingClient | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      router.replace("/");
      return;
    }
    const client = makeClient();
    client.setToken(token);
    clientRef.current = client;
    client
      .me()
      .then(setMe)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [router]);

  useEffect(() => {
    const client = clientRef.current;
    if (!me || !client) return;
    return client.events((e) => {
      if (
        typeof e.type === "string" &&
        /^(note_created|note_consumed|approval_)/.test(e.type)
      ) {
        setTick((t) => t + 1);
      }
    });
  }, [me]);

  const refreshMe = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    setMe(await client.me());
  }, []);

  const openPublic = useCallback(() => setDrawerOpen(true), []);

  function logout() {
    clearAuth();
    router.replace("/");
  }

  if (error) {
    return (
      <main className="mx-auto max-w-md px-6 py-24 text-center">
        <p className="err">{error}</p>
        <button className="btn mt-4" onClick={logout}>
          Back to login
        </button>
      </main>
    );
  }

  if (!me) {
    return <main className="p-8 text-sm text-ink-5">Loading…</main>;
  }

  const ringUrl = getRingUrl() ?? "";
  const allow = (n: NavItem) => {
    const capOk =
      me.capabilities.includes(n.cap) || (n.cap === "my-pay" && me.user.role === "admin");
    const modOk = !n.module || me.enabledModules.includes(n.module);
    return capOk && modOk;
  };
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter(allow) })).filter(
    (g) => g.items.length,
  );

  return (
    <RingContext.Provider
      value={{ client: clientRef.current!, me, ringUrl, tick, refreshMe, logout, openPublic }}
    >
      <div className="fixed inset-0 flex overflow-hidden bg-paper text-ink-2">
        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <nav className="flex w-[236px] shrink-0 flex-col overflow-hidden border-r border-line-soft bg-ground">
          {/* Brand block — bare gold rings + the org's ENS name */}
          <div className="px-3.5 pt-3.5 pb-2.5">
            <div className="flex items-center gap-2.5 rounded-xl border border-line bg-paper px-3 py-2.5 shadow-[0_1px_2px_rgb(20_30_45/0.04)]">
              <BorromeanMark size={28} className="shrink-0" />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[13px] font-medium text-ink">
                  {me.ens ?? me.org.toLowerCase() + ".aragorn.eth"}
                </div>
              </div>
            </div>
          </div>

          {/* Search affordance */}
          <div className="px-3.5 pb-2.5">
            <div className="flex items-center gap-2 rounded-lg border border-line bg-paper px-2.5 py-1.5">
              <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0 text-ink-6">
                <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <span className="flex-1 text-[12px] text-ink-6">Search</span>
              <span className="rounded border border-line px-[5px] py-px text-[10px] text-ink-7">⌘F</span>
            </div>
          </div>

          {/* Grouped nav */}
          <div className="flex-1 overflow-auto py-0.5 pb-2">
            {groups.map((g) => (
              <div key={g.label}>
                <div className="px-6 pt-3 pb-1.5 text-[10px] tracking-[0.16em] text-ink-6 uppercase">
                  {g.label}
                </div>
                {g.items.map((n) => {
                  const active =
                    pathname === n.href ||
                    (n.href !== "/" && pathname.startsWith(n.href + "/")) ||
                    (n.href === "/repo" && pathname.startsWith("/repo"));
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      className={`mx-3 my-px flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-[13px] outline-none transition-colors ${
                        active
                          ? "border-line bg-paper font-medium text-ink shadow-[0_1px_2px_rgb(20_30_45/0.06)]"
                          : n.roadmap
                            ? "border-transparent text-ink-7 hover:bg-paper/60"
                            : "border-transparent text-ink-3 hover:bg-paper/60"
                      }`}
                    >
                      <i
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: active ? "#b08833" : "transparent" }}
                      />
                      <span className="flex-1">{n.label}</span>
                      {n.roadmap && <span className="badge-roadmap">soon</span>}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Role footer */}
          <div className="flex items-center gap-2.5 border-t border-line-soft px-3.5 py-2.5">
            <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-line bg-ground-3 text-[10.5px] text-ink-3">
              {initials(me.user.email)}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[12px] text-ink">{me.user.email.split("@")[0]}</div>
              <div className="truncate text-[10px] text-ink-5">{me.user.email}</div>
            </div>
            <span className="rounded-md border border-steel/40 px-1.5 py-1 text-[9.5px] tracking-[0.06em] text-steel uppercase">
              {me.user.role}
            </span>
          </div>
          <button
            className="border-t border-line-soft px-3.5 py-2 text-left text-[11px] text-ink-5 hover:text-ink-3"
            onClick={logout}
          >
            Sign out
          </button>
        </nav>

        {/* ── Main + public panel ─────────────────────────────────────────── */}
        <main className="flex min-w-0 flex-1">
          <section className="relative min-w-0 flex-1 overflow-auto">{children}</section>

          {drawerOpen && (
            <aside className="flex w-[39%] max-w-[540px] min-w-[350px] shrink-0 flex-col overflow-hidden border-l border-line bg-paper">
              <div className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
                <div>
                  <div className="text-[10px] tracking-[0.16em] text-ink-5 uppercase">
                    What the world sees
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-4">
                    Public Ethereum · settlement contract
                  </div>
                </div>
                <button
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-5 hover:text-ink"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close public view"
                >
                  ×
                </button>
              </div>
              <PublicFeed ringUrl={ringUrl} />
            </aside>
          )}
        </main>
      </div>
    </RingContext.Provider>
  );
}
