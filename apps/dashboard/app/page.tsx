"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, useLogin, getAccessToken } from "@privy-io/react-auth";
import {
  RINGS,
  type RingKey,
  getRingKey,
  setRingKey,
  makeClient,
  storeBiscuit,
  storeDevToken,
} from "@/lib/ring";
import { privyConfigured } from "./providers";
import { BorromeanMark, RingGlyph } from "@/components/rings";

// Each entrance is a ring: UBS wears the gold accent, DRW the steel.
const RING_STYLE: Record<RingKey, { color: string; idle: string; selected: string }> = {
  ubs: {
    color: "#b08833",
    idle: "border-gold/35 hover:border-gold/70",
    selected: "border-gold bg-gold/[0.07]",
  },
  drw: {
    color: "#1c4f68",
    idle: "border-steel/30 hover:border-steel/60",
    selected: "border-steel bg-steel/[0.07]",
  },
};

export default function LoginPage() {
  const router = useRouter();
  const [ring, setRing] = useState<RingKey | null>(null);
  const [devToken, setDevToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRing(getRingKey());
  }, []);

  function pickRing(k: RingKey) {
    setRingKey(k);
    setRing(k);
    setError(null);
  }

  async function exchangePrivyToken(privyToken: string) {
    const client = makeClient();
    const { biscuit } = await client.exchange(privyToken);
    storeBiscuit(biscuit);
    router.push("/portfolio");
  }

  async function devLogin() {
    setError(null);
    if (!ring) return setError("Select a ring first");
    const token = devToken.trim();
    if (!token) return setError("Enter a dev token");
    setBusy(true);
    try {
      storeDevToken(token);
      await makeClient().me(); // validate the token against the ring
      router.push("/portfolio");
    } catch (e) {
      localStorage.removeItem("dev-token");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center bg-ground px-6 py-12">
      <div className="mb-10 flex flex-col items-center text-center">
        <BorromeanMark size={56} />
        <h1 className="mt-6 text-xl font-semibold tracking-[0.3em] text-ink">
          ARAGORN
        </h1>
        <p className="mt-2 text-[13px] text-ink-5">
          Private institutional settlement on public Ethereum
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <div className="label">Enter your ring</div>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(RINGS) as RingKey[]).map((k) => {
              const s = RING_STYLE[k];
              return (
                <button
                  key={k}
                  onClick={() => pickRing(k)}
                  className={`flex flex-col items-center gap-2.5 rounded-xl border bg-paper px-4 py-6 text-sm font-medium text-ink-2 shadow-[0_1px_2px_rgb(20_30_45/0.04)] transition-colors ${
                    ring === k ? s.selected : s.idle
                  }`}
                >
                  <RingGlyph size={26} color={s.color} />
                  {RINGS[k].label}
                </button>
              );
            })}
          </div>
        </div>

        {privyConfigured() ? (
          <PrivyLoginButton
            ring={ring}
            onError={(m) => setError(m)}
            onToken={exchangePrivyToken}
          />
        ) : (
          <p className="text-xs text-ink-5">
            Privy is not configured (set NEXT_PUBLIC_PRIVY_APP_ID). Use a dev token
            below.
          </p>
        )}

        <details className="border-t border-line-soft pt-4">
          <summary className="cursor-pointer text-[10px] tracking-[0.18em] text-ink-6 uppercase transition-colors hover:text-ink-4">
            Developer
          </summary>
          <div className="mt-3">
            <label className="label" htmlFor="dev-token">
              Dev token (bypass Privy)
            </label>
            <div className="flex gap-2">
              <input
                id="dev-token"
                className="input flex-1"
                placeholder="e.g. ubs-api-token"
                value={devToken}
                onChange={(e) => setDevToken(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && devLogin()}
              />
              <button className="btn" disabled={busy} onClick={devLogin}>
                Use
              </button>
            </div>
          </div>
        </details>

        {error && <p className="err">{error}</p>}
      </div>
    </main>
  );
}

function PrivyLoginButton({
  ring,
  onError,
  onToken,
}: {
  ring: RingKey | null;
  onError: (msg: string) => void;
  onToken: (privyToken: string) => Promise<void>;
}) {
  const { ready, authenticated } = usePrivy();
  const [busy, setBusy] = useState(false);

  async function doExchange() {
    setBusy(true);
    try {
      const t = await getAccessToken();
      if (!t) throw new Error("No Privy access token");
      await onToken(t);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const { login } = useLogin({
    onComplete: () => void doExchange(),
    onError: (e) => onError(String(e)),
  });

  function click() {
    onError("");
    if (!ring) return onError("Select a ring first");
    if (authenticated) void doExchange();
    else login();
  }

  return (
    <button className="btn-primary w-full" disabled={!ready || busy} onClick={click}>
      {busy ? "Signing in…" : "Sign in with Privy"}
    </button>
  );
}
