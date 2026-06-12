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

// Nav = capability ∩ enabledModules (PLAN §6 module model). Core pages carry
// no module key; module pages appear only when the admin has switched the
// module on in Settings → Features. Roadmap modules route to preview pages.
interface NavItem {
  href: string;
  label: string;
  cap: string;
  module?: string;
  roadmap?: boolean;
}

const NAV: NavItem[] = [
  { href: "/portfolio", label: "Portfolio", cap: "portfolio" },
  { href: "/transfer", label: "Transfer", cap: "transfer", module: "payments" },
  { href: "/repo", label: "Repo", cap: "repo", module: "repo" },
  { href: "/payroll", label: "Payroll", cap: "payroll", module: "payroll" },
  { href: "/issuance", label: "Issuance", cap: "portfolio", module: "issuance" },
  { href: "/strategies", label: "Strategies", cap: "strategies", module: "strategies" },
  { href: "/roadmap/lending", label: "Lending", cap: "portfolio", module: "lending", roadmap: true },
  { href: "/roadmap/fx", label: "FX", cap: "portfolio", module: "fx", roadmap: true },
  { href: "/roadmap/compliance", label: "Compliance", cap: "portfolio", module: "compliance", roadmap: true },
  { href: "/roadmap/reports", label: "Reports", cap: "portfolio", module: "reports", roadmap: true },
  { href: "/my-pay", label: "My Pay", cap: "my-pay", module: "payroll" },
  { href: "/approvals", label: "Approvals", cap: "approvals" },
  { href: "/admin", label: "Admin", cap: "admin" },
  { href: "/audit", label: "Audit", cap: "audit" },
  { href: "/settings", label: "Settings", cap: "admin" },
];

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

  // Live updates: one SSE subscription for the whole shell; pages refetch on tick.
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
    return <main className="p-8 text-sm text-slate-500">Loading…</main>;
  }

  const ringUrl = getRingUrl() ?? "";
  const navItems = NAV.filter((n) => {
    const capOk =
      me.capabilities.includes(n.cap) ||
      // demo convenience: admins can drive the My Pay flow too
      (n.cap === "my-pay" && me.user.role === "admin");
    const modOk = !n.module || me.enabledModules.includes(n.module);
    return capOk && modOk;
  });

  return (
    <RingContext.Provider
      value={{ client: clientRef.current!, me, ringUrl, tick, refreshMe, logout }}
    >
      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between border-b border-white/8 bg-slate-900/70 px-4 py-2">
          <div className="flex items-center gap-3">
            <BorromeanMark size={24} />
            <span className="text-[13px] font-semibold tracking-[0.32em] text-slate-100">
              ARAGORN
            </span>
            <span className="h-3.5 w-px bg-white/10" aria-hidden />
            <span className="text-sm text-slate-300">{me.org}</span>
            {me.ens && (
              <span className="font-mono text-[11px] text-gold-dim">{me.ens}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              className={`btn ${drawerOpen ? "border-gold/40 text-gold" : ""}`}
              onClick={() => setDrawerOpen((o) => !o)}
            >
              Public view
            </button>
            <span className="text-sm text-slate-400">{me.user.email}</span>
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] tracking-[0.14em] text-slate-300 uppercase">
              {me.user.role}
            </span>
            <button className="btn" onClick={logout}>
              Logout
            </button>
          </div>
        </header>

        <div className="flex flex-1">
          <nav className="flex w-44 shrink-0 flex-col border-r border-white/8 bg-slate-900/40 p-3">
            <ul className="space-y-0.5">
              {navItems.map((n) => {
                const active = pathname.startsWith(n.href);
                return (
                  <li key={n.href}>
                    <Link
                      href={n.href}
                      className={`flex items-center justify-between rounded-sm border-l-2 px-3 py-1.5 text-sm transition-colors ${
                        active
                          ? "border-gold bg-white/[0.05] text-slate-100"
                          : "border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                      } ${n.roadmap && !active ? "text-slate-500" : ""}`}
                    >
                      {n.label}
                      {n.roadmap && (
                        <svg width="10" height="10" viewBox="0 0 16 16" aria-label="roadmap preview">
                          <circle
                            cx="8"
                            cy="8"
                            r="5.5"
                            fill="none"
                            stroke="#c9a84c"
                            strokeWidth="1.4"
                            strokeDasharray="2.6 2.8"
                            opacity="0.7"
                          />
                        </svg>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-auto px-3 pt-6 text-[10px] text-slate-600 italic">
              keep it secret, keep it safe.
            </p>
          </nav>

          <main className="min-w-0 flex-1 p-6">{children}</main>

          {drawerOpen && (
            <aside className="flex w-96 shrink-0 flex-col border-l border-white/8 bg-slate-900/70 p-4">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-[11px] font-medium tracking-[0.18em] text-slate-300 uppercase">
                  What the world sees
                </h2>
                <button className="btn" onClick={() => setDrawerOpen(false)}>
                  Close
                </button>
              </div>
              <PublicFeed ringUrl={ringUrl} />
            </aside>
          )}
        </div>
      </div>
    </RingContext.Provider>
  );
}
