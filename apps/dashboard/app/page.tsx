"use client";

// Login flow: sign in FIRST (work email via Privy, or a dev token), then resolve which
// Rings this identity can access and show them. No Ring? Create one (onboarding).
// There is no "pick a ring before you log in" — a Ring is something you belong to.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, useLogin, getAccessToken } from "@privy-io/react-auth";
import {
  type AccessibleRing,
  type RingKey,
  clearAuth,
  enterCustomRing,
  enterRing,
  probeDevToken,
  probePrivy,
  storeDevToken,
} from "@/lib/ring";
import { cleanError } from "@aragorn/sdk";
import { privyConfigured } from "./providers";
import { BorromeanMark, RingGlyph } from "@/components/rings";

const COORDINATOR_URL =
  process.env.NEXT_PUBLIC_COORDINATOR_URL ?? "http://127.0.0.1:4900";

type Phase = "signin" | "rings" | "onboard";

export default function LoginPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("signin");
  const [rings, setRings] = useState<AccessibleRing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The signed-in identity's email, captured at login so onboarding can invite the founder.
  // Undefined on the dev-token path (no email) — provisioning falls back to a slug address.
  const [founderEmail, setFounderEmail] = useState<string | undefined>(undefined);

  // After authenticating, resolve accessible rings → the picker (which handles the
  // empty state). We don't jump straight into onboarding: "no rings" is often transient
  // (a Ring restarting) and the user should see why + be able to retry.
  function resolveRings(found: AccessibleRing[]) {
    setRings(found);
    setPhase("rings");
  }

  async function onPrivyToken(privyToken: string, email?: string) {
    clearAuth(); // a fresh Privy session shouldn't inherit a stale dev token
    if (email) setFounderEmail(email);
    const found = await probePrivy(privyToken);
    resolveRings(found);
  }

  async function onDevToken(token: string) {
    setError(null);
    setBusy(true);
    try {
      const found = await probeDevToken(token);
      if (!found.length) throw new Error("token not valid on any Ring");
      storeDevToken(token);
      resolveRings(found);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function enter(ring: RingKey) {
    enterRing(ring);
    router.push("/portfolio");
  }

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-ground px-6 py-12">
      {/* faint gold Borromean watermark, bleeding off the top-right (matches the app) */}
      <svg
        width="640"
        height="640"
        viewBox="0 0 400 400"
        aria-hidden
        className="pointer-events-none absolute -top-[120px] -right-[140px] z-0"
      >
        <g fill="none" stroke="#b08833" strokeWidth="1.3" strokeOpacity="0.12">
          <circle cx="190" cy="150" r="120" />
          <circle cx="270" cy="150" r="120" />
          <circle cx="230" cy="240" r="120" />
        </g>
      </svg>

      <div className="relative z-[1] w-full max-w-sm rounded-2xl border border-line bg-paper px-8 py-10 shadow-[0_2px_24px_rgb(20_30_45/0.06)]">
        <div className="mb-9 flex flex-col items-center text-center">
          <BorromeanMark size={52} />
          <h1 className="mt-6 text-xl font-semibold tracking-[0.3em] text-ink">ARAGORN</h1>
          <p className="mt-2 text-[13px] text-ink-5">
            Private institutional settlement on public Ethereum
          </p>
        </div>

      {phase === "signin" && (
        <SignIn
          configured={privyConfigured()}
          busy={busy}
          error={error}
          setError={setError}
          onPrivyToken={onPrivyToken}
          onDevToken={onDevToken}
        />
      )}

      {phase === "rings" && (
        <RingPicker rings={rings} onEnter={enter} onCreate={() => setPhase("onboard")} />
      )}

      {phase === "onboard" && (
        <Onboard
          onCancel={() => setPhase(rings.length ? "rings" : "signin")}
          hasRings={rings.length > 0}
          founderEmail={founderEmail}
          onDone={() => router.push("/portfolio")}
        />
      )}
      </div>
    </main>
  );
}

/* ── Step 1: sign in ──────────────────────────────────────────────────────── */
function SignIn({
  configured,
  busy,
  error,
  setError,
  onPrivyToken,
  onDevToken,
}: {
  configured: boolean;
  busy: boolean;
  error: string | null;
  setError: (m: string | null) => void;
  onPrivyToken: (t: string, email?: string) => Promise<void>;
  onDevToken: (t: string) => Promise<void>;
}) {
  const [devToken, setDevToken] = useState("");
  return (
    <div className="space-y-5">
      {configured ? (
        <PrivyButton onError={setError} onToken={onPrivyToken} />
      ) : (
        <p className="text-xs text-ink-5">
          Privy is not configured (set NEXT_PUBLIC_PRIVY_APP_ID). Use a dev token below.
        </p>
      )}
      <p className="text-center text-[12px] text-ink-5">
        Sign in with your work email. No wallet, no keys.
      </p>

      <details className="border-t border-line-soft pt-4">
        <summary className="cursor-pointer text-[10px] tracking-[0.18em] text-ink-6 uppercase transition-colors hover:text-ink-4">
          Developer
        </summary>
        <div className="mt-3">
          <label className="label" htmlFor="dev-token">
            Service / dev token
          </label>
          <div className="flex gap-2">
            <input
              id="dev-token"
              className="input flex-1"
              placeholder="e.g. ubs-api-token"
              value={devToken}
              onChange={(e) => setDevToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && devToken.trim() && onDevToken(devToken.trim())}
            />
            <button
              className="btn"
              disabled={busy || !devToken.trim()}
              onClick={() => onDevToken(devToken.trim())}
            >
              {busy ? "…" : "Use"}
            </button>
          </div>
        </div>
      </details>

      {error && <p className="err">{error}</p>}
    </div>
  );
}

function PrivyButton({
  onError,
  onToken,
}: {
  onError: (m: string | null) => void;
  onToken: (t: string, email?: string) => Promise<void>;
}) {
  const { ready, authenticated, user } = usePrivy();
  const [busy, setBusy] = useState(false);

  async function exchange() {
    setBusy(true);
    try {
      const t = await getAccessToken();
      if (!t) throw new Error("no Privy access token");
      const email = user?.email?.address ?? user?.google?.email ?? undefined;
      await onToken(t, email);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const { login } = useLogin({
    onComplete: () => void exchange(),
    onError: (e) => onError(String(e)),
  });

  return (
    <button
      className="btn-primary w-full"
      disabled={!ready || busy}
      onClick={() => {
        onError(null);
        authenticated ? void exchange() : login();
      }}
    >
      {busy ? "Signing in…" : "Sign in with Privy"}
    </button>
  );
}

/* ── Step 2: pick a Ring you belong to ────────────────────────────────────── */
function RingPicker({
  rings,
  onEnter,
  onCreate,
}: {
  rings: AccessibleRing[];
  onEnter: (k: RingKey) => void;
  onCreate: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="label">Your Rings</div>
      {rings.length === 0 && (
        <p className="rounded-lg border border-line bg-ground px-3 py-3 text-[12.5px] leading-relaxed text-ink-4">
          No Rings found for your email yet. If your institution runs a Ring, an admin needs
          to invite you — then sign in again. Or create your own below.
        </p>
      )}
      <div className="space-y-2.5">
        {rings.map((r) => (
          <button
            key={r.key}
            onClick={() => onEnter(r.key)}
            className="flex w-full items-center gap-3 rounded-xl border border-line bg-paper px-4 py-3.5 text-left shadow-[0_1px_2px_rgb(20_30_45/0.04)] transition-colors hover:border-steel/50"
          >
            <RingGlyph size={26} color="#b08833" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink">{r.org}</div>
              <div className="truncate font-mono text-[11px] text-steel">
                {r.ens ?? `${r.org.toLowerCase()}.aragorn.eth`}
              </div>
            </div>
            <span className="rounded-md border border-steel/40 px-1.5 py-1 text-[9.5px] tracking-[0.06em] text-steel uppercase">
              {r.role}
            </span>
          </button>
        ))}
      </div>
      <button
        onClick={onCreate}
        className="w-full rounded-xl border border-dashed border-line px-4 py-3 text-[13px] text-ink-5 transition-colors hover:border-steel/40 hover:text-ink-3"
      >
        + Create a new Ring
      </button>
    </div>
  );
}

/* ── Create a Ring (onboarding) — the design's 3-step flow ────────────────── */
function Onboard({
  onCancel,
  hasRings,
  founderEmail,
  onDone,
}: {
  onCancel: () => void;
  hasRings: boolean;
  founderEmail?: string;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const slug = (name || "your-institution").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const ens = `${slug}.aragorn.eth`;

  // Provision a REAL sovereign Ring through the coordinator: own process + DB + keys +
  // ENS metadata. Takes ~1 min (ENS writes on Sepolia + node boot) — keep the spinner up.
  async function provision() {
    setError(null);
    setStep(2);
    try {
      const email = founderEmail ?? `admin@${slug}.aragorn.eth`;
      const res = await fetch(`${COORDINATOR_URL}/provision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgName: name, founderEmail: email }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ringUrl?: string;
        ens?: string;
        apiToken?: string;
        error?: string;
      };
      if (!res.ok || data.error || !data.ringUrl || !data.apiToken) {
        throw new Error(data.error ?? `provisioning failed (HTTP ${res.status})`);
      }
      enterCustomRing({
        url: data.ringUrl,
        token: data.apiToken,
        label: name,
        ens: data.ens ?? ens,
      });
      onDone();
    } catch (e) {
      setError(cleanError(e));
      setStep(1);
    }
  }

  return (
    <div className="space-y-5 text-center">
      {step === 0 && (
        <>
          <div className="text-[20px] text-ink">Create your Ring</div>
          <p className="text-[12.5px] leading-relaxed text-ink-4">
            Your sovereign private ledger node. Name your institution — this becomes your ENS
            on Aragorn.
          </p>
          <div className="mt-2 text-left">
            <div className="label">Institution name</div>
            <input
              autoFocus
              className="input w-full"
              placeholder="UBS"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep(1)}
            />
            <div className="mt-2 font-mono text-[12px] text-steel">{ens}</div>
          </div>
          <button
            className="btn-primary w-full"
            disabled={!name.trim()}
            onClick={() => setStep(1)}
          >
            Continue
          </button>
        </>
      )}

      {step === 1 && (
        <>
          <div className="text-[20px] text-ink">Invite your team</div>
          <p className="text-[12.5px] leading-relaxed text-ink-4">
            Add colleagues by work email. Roles and limits can be set later in Admin. No
            wallets, no keys.
          </p>
          <div className="mt-2 flex flex-col gap-2 text-left">
            {["cfo", "trader", "ops"].map((u) => (
              <div
                key={u}
                className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-[13px] text-ink-6"
              >
                + {u}@{(name || "institution").toLowerCase().replace(/[^a-z0-9]+/g, "")}.com
              </div>
            ))}
          </div>
          <button className="btn-primary w-full" onClick={() => void provision()}>
            Create Ring
          </button>
          {error && <p className="err">{error}</p>}
        </>
      )}

      {step === 2 && (
        <div className="flex flex-col items-center">
          <svg width="84" height="84" viewBox="0 0 100 100" aria-hidden>
            <circle cx="50" cy="50" r="38" fill="none" stroke="rgb(23 32 42 / 0.1)" strokeWidth="5" />
            <g className="ring-orbit" style={{ transformOrigin: "50px 50px" }}>
              <circle
                cx="50"
                cy="50"
                r="38"
                fill="none"
                stroke="#b08833"
                strokeWidth="5"
                strokeDasharray="60 240"
                strokeLinecap="round"
              />
            </g>
          </svg>
          <div className="mt-5 text-[18px] text-ink">Deploying your Ring…</div>
          <p className="mt-1.5 text-[12px] text-ink-4">
            Registering <span className="font-mono text-steel">{ens}</span> · provisioning
            private ledger node
          </p>
          <p className="mt-4 max-w-xs text-[11px] leading-relaxed text-ink-6">
            Generating keys, creating the ledger database, publishing ENS metadata, and
            booting your sovereign node. This takes about a minute — keep this tab open.
          </p>
        </div>
      )}

      {step < 2 && (
        <button
          className="text-[11px] text-ink-6 hover:text-ink-4"
          onClick={() => (step === 0 ? onCancel() : setStep(step - 1))}
        >
          {step === 0 ? "Cancel" : "Back"}
        </button>
      )}
    </div>
  );
}
