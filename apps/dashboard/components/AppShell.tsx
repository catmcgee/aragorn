"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cleanError, type Me, type RingClient } from "@aragorn/sdk";
import {
  RingContext,
  clearAuth,
  getRingUrl,
  getStoredToken,
  makeClient,
} from "@/lib/ring";
import PublicFeed from "./PublicFeed";
import { BorromeanMark } from "./rings";
import WalletPopover from "./WalletPopover";

const privyConfigured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

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
  const [walletOpen, setWalletOpen] = useState(false);
  const [pendingInbox, setPendingInbox] = useState(0);
  const [publicTx, setPublicTx] = useState<string | null>(null);

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
      .catch((e) => setError(cleanError(e)));
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

  // Pending inbox (four-eyes approvals) count → drives the sidebar notification ring.
  // Only the roles that can see approvals fetch it; refetched on approval_* events (tick).
  useEffect(() => {
    const client = clientRef.current;
    if (!me || !client || !me.capabilities.includes("approvals")) {
      setPendingInbox(0);
      return;
    }
    let live = true;
    client
      .approvals()
      .then((r) => live && setPendingInbox(r.approvals.filter((a) => a.status === "pending").length))
      .catch(() => live && setPendingInbox(0));
    return () => {
      live = false;
    };
  }, [me, tick]);

  const refreshMe = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    setMe(await client.me());
  }, []);

  const openPublic = useCallback((txid?: string) => {
    setPublicTx(txid ?? null);
    setDrawerOpen(true);
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

          {/* Inbox — four-eyes approvals; a gold ring appears when something is pending */}
          <div className="px-3.5 pb-2.5">
            <Link
              href="/approvals"
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${
                pathname.startsWith("/approvals")
                  ? "border-line bg-paper shadow-[0_1px_2px_rgb(20_30_45/0.06)]"
                  : "border-line bg-paper hover:bg-paper/60"
              }`}
            >
              <span className="relative shrink-0">
                <svg width="15" height="15" viewBox="0 0 16 16" className="text-ink-5">
                  <path
                    d="M2 9.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5M2 9.5l1.6-5.2a1 1 0 0 1 1-.7h6.8a1 1 0 0 1 1 .7L14 9.5M2 9.5h3l.9 1.6h4.2l.9-1.6h3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </svg>
                {pendingInbox > 0 && (
                  <svg width="9" height="9" viewBox="0 0 9 9" className="absolute -top-1 -right-1.5">
                    <circle cx="4.5" cy="4.5" r="3.2" fill="#fff" stroke="#b08833" strokeWidth="1.6" />
                  </svg>
                )}
              </span>
              <span className="flex-1 text-[12px] text-ink-3">Inbox</span>
              {pendingInbox > 0 && (
                <span className="text-[10px] font-medium tabular-nums text-gold-deep">{pendingInbox}</span>
              )}
            </Link>
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

          {/* Role footer — opens the wallet popover */}
          <button
            type="button"
            className="flex items-center gap-2.5 border-t border-line-soft px-3.5 py-2.5 text-left transition-colors hover:bg-paper/60"
            onClick={() => setWalletOpen((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={walletOpen}
          >
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
          </button>
        </nav>

        {/* ── Main + public panel ─────────────────────────────────────────── */}
        <main className="flex min-w-0 flex-1">
          <section className="relative min-w-0 flex-1 overflow-auto">
            {/* faint gold Borromean watermark bleeding off the top-right (design line 85) */}
            <svg
              width="500"
              height="500"
              viewBox="0 0 400 400"
              aria-hidden
              className="pointer-events-none absolute -top-[66px] -right-[86px] z-0"
            >
              <g fill="none" stroke="#b08833" strokeWidth="1.3" strokeOpacity="0.16">
                <circle cx="190" cy="150" r="120" />
                <circle cx="270" cy="150" r="120" />
                <circle cx="230" cy="240" r="120" />
              </g>
            </svg>
            <div className="relative z-[1]">{children}</div>
          </section>

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
              <PublicFeed ringUrl={ringUrl} highlightTx={publicTx} />
            </aside>
          )}
        </main>

        {/* ── Account modal (centered) ────────────────────────────────────── */}
        {walletOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-ink/25 backdrop-blur-[1.5px]"
              onClick={() => setWalletOpen(false)}
              aria-hidden
            />
            <div
              role="dialog"
              aria-label="Account"
              aria-modal="true"
              className="relative z-10 w-full max-w-md rounded-2xl border border-line bg-paper p-5 shadow-[0_18px_60px_rgb(20_30_45/0.24)]"
            >
              {/* identity header */}
              <div className="flex items-start gap-3 border-b border-line-soft pb-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-ground-3 text-[13px] text-ink-3">
                  {initials(me.user.email)}
                </div>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-[14px] font-medium text-ink">
                    {me.user.email.split("@")[0]}
                  </div>
                  <div className="truncate text-[11.5px] text-ink-5">{me.user.email}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-ink-6">
                    <span className="truncate">{me.ens ?? me.org}</span>
                    <span className="rounded border border-steel/40 px-1 py-px tracking-[0.06em] text-steel uppercase">
                      {me.user.role}
                    </span>
                  </div>
                </div>
                <button
                  className="flex h-6 w-6 items-center justify-center rounded text-ink-6 hover:text-ink"
                  onClick={() => setWalletOpen(false)}
                  aria-label="Close account"
                >
                  ×
                </button>
              </div>

              {/* wallet + balances */}
              <div className="py-4">
                {privyConfigured ? (
                  <WalletPopover onClose={() => setWalletOpen(false)} />
                ) : (
                  <p className="text-[12px] text-ink-5">
                    Signed in with a service token — no embedded wallet
                  </p>
                )}
              </div>

              {/* sign out lives inside the account panel */}
              <button className="btn w-full border-t border-line-soft" onClick={logout}>
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </RingContext.Provider>
  );
}
