"use client";

import { useEffect, useRef, useState } from "react";
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

const NAV: { href: string; label: string; cap: string }[] = [
  { href: "/portfolio", label: "Portfolio", cap: "portfolio" },
  { href: "/transfer", label: "Transfer", cap: "transfer" },
  { href: "/repo", label: "Repo", cap: "repo" },
  { href: "/payroll", label: "Payroll", cap: "payroll" },
  { href: "/strategies", label: "Strategies", cap: "strategies" },
  { href: "/my-pay", label: "My Pay", cap: "my-pay" },
  { href: "/approvals", label: "Approvals", cap: "approvals" },
  { href: "/admin", label: "Admin", cap: "admin" },
  { href: "/audit", label: "Audit", cap: "audit" },
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
  const navItems = NAV.filter(
    (n) =>
      me.capabilities.includes(n.cap) ||
      // demo convenience: admins can drive the My Pay flow too
      (n.cap === "my-pay" && me.user.role === "admin"),
  );

  return (
    <RingContext.Provider
      value={{ client: clientRef.current!, me, ringUrl, tick, logout }}
    >
      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2">
          <div className="flex items-baseline gap-3">
            <span className="font-semibold text-slate-100">Aragorn</span>
            <span className="text-sm text-slate-300">{me.org}</span>
            {me.ens && <span className="text-xs text-slate-500">{me.ens}</span>}
          </div>
          <div className="flex items-center gap-3">
            <button className="btn" onClick={() => setDrawerOpen((o) => !o)}>
              Public view
            </button>
            <span className="text-sm text-slate-400">{me.user.email}</span>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
              {me.user.role}
            </span>
            <button className="btn" onClick={logout}>
              Logout
            </button>
          </div>
        </header>

        <div className="flex flex-1">
          <nav className="w-44 shrink-0 border-r border-slate-800 bg-slate-900/50 p-3">
            <ul className="space-y-1">
              {navItems.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    className={`block rounded px-3 py-1.5 text-sm ${
                      pathname.startsWith(n.href)
                        ? "bg-slate-800 text-slate-100"
                        : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                    }`}
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <main className="min-w-0 flex-1 p-6">{children}</main>

          {drawerOpen && (
            <aside className="w-96 shrink-0 border-l border-slate-800 bg-slate-900/70 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-medium text-slate-200">Public view</h2>
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
