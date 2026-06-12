"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, useLogin, getAccessToken } from "@privy-io/react-auth";
import {
  RINGS,
  type RingKey,
  getRingKey,
  setRingKey,
  getStoredToken,
  makeClient,
  storeBiscuit,
  storeDevToken,
} from "@/lib/ring";
import { privyConfigured } from "./providers";

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold text-slate-100">Aragorn</h1>
      <p className="mb-8 text-sm text-slate-400">Private institutional settlement</p>

      <div className="card space-y-6">
        <div>
          <div className="label">Ring</div>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(RINGS) as RingKey[]).map((k) => (
              <button
                key={k}
                onClick={() => pickRing(k)}
                className={`rounded-md border px-4 py-6 text-base font-medium ${
                  ring === k
                    ? "border-slate-400 bg-slate-700 text-slate-100"
                    : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {RINGS[k].label}
              </button>
            ))}
          </div>
        </div>

        {privyConfigured() ? (
          <PrivyLoginButton
            ring={ring}
            onError={(m) => setError(m)}
            onToken={exchangePrivyToken}
          />
        ) : (
          <p className="text-xs text-slate-500">
            Privy is not configured (set NEXT_PUBLIC_PRIVY_APP_ID). Use a dev token below.
          </p>
        )}

        <div className="border-t border-slate-800 pt-4">
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
