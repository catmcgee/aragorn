"use client";

// My Pay — the flagship private payroll flow. The salary entitlement is fetched
// from the ring, but the ZK proof that claims it is generated entirely in this
// browser (web worker): the claim secret and amount never leave the device.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRing } from "@/lib/ring";
import { getStoredToken } from "@/lib/ring";
import { fmtMicro } from "@/lib/format";
import type { ClaimData } from "@/lib/claimProver";
import type { ProverResponse } from "@/workers/prover";
import { ProgressRing } from "@/components/rings";

// Proving stages as a closing ring — the fraction grows as the proof nears done.
const STAGE_FRACTION: Record<string, number> = {
  fetching: 0.1,
  "loading-circuit": 0.3,
  "executing-witness": 0.55,
  proving: 0.8,
  submitting: 0.95,
};

type Phase =
  | { step: "idle" }
  | { step: "fetching" }
  | { step: "ready" }
  | { step: "loading-circuit" }
  | { step: "executing-witness" }
  | { step: "proving" }
  | { step: "submitting" }
  | { step: "claimed"; txid: string };

const STATUS_TEXT: Record<string, string> = {
  fetching: "Fetching claimable salary…",
  "loading-circuit": "Loading circuit…",
  "executing-witness": "Executing witness…",
  proving: "Generating proof locally — your salary never leaves this device",
  submitting: "Submitting claim…",
};

export default function MyPayPage() {
  const { ringUrl } = useRing();
  const [employeeId, setEmployeeId] = useState("1");
  const [claimData, setClaimData] = useState<ClaimData | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const authedPost = useCallback(
    async (path: string, body: unknown) => {
      const token = getStoredToken();
      const res = await fetch(`${ringUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok && res.status !== 202) {
        throw new Error((json.error as string) ?? `HTTP ${res.status}`);
      }
      return json;
    },
    [ringUrl],
  );

  async function fetchClaimable() {
    setError(null);
    setClaimData(null);
    setPhase({ step: "fetching" });
    try {
      const data = await authedPost("/v1/payroll/claim-data", {
        employeeId: Number(employeeId),
      });
      setClaimData(data as unknown as ClaimData);
      setPhase({ step: "ready" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase({ step: "idle" });
    }
  }

  function claimPrivately() {
    if (!claimData) return;
    setError(null);
    setPhase({ step: "loading-circuit" });

    const worker = new Worker(
      new URL("../../../workers/prover.ts", import.meta.url),
    );
    workerRef.current = worker;

    worker.onmessage = async (e: MessageEvent<ProverResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        if (msg.stage !== "done") setPhase({ step: msg.stage });
        return;
      }
      worker.terminate();
      workerRef.current = null;
      if (msg.type === "error") {
        setError(msg.message);
        setPhase({ step: "ready" });
        return;
      }
      // proof generated locally — only proof + public inputs leave the device
      setPhase({ step: "submitting" });
      try {
        const res = await authedPost("/v1/payroll/submit-claim", {
          proof: msg.proof,
          publicInputs: msg.publicInputs,
        });
        setPhase({ step: "claimed", txid: String(res.txid) });
        setClaimData(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase({ step: "ready" });
      }
    };

    worker.onerror = (e) => {
      worker.terminate();
      workerRef.current = null;
      setError(e.message || "prover worker failed");
      setPhase({ step: "ready" });
    };

    worker.postMessage({ type: "prove", claimData });
  }

  const busy =
    phase.step === "fetching" ||
    phase.step === "loading-circuit" ||
    phase.step === "executing-witness" ||
    phase.step === "proving" ||
    phase.step === "submitting";

  return (
    <div className="px-8 py-6 max-w-xl">
      <div className="mb-5">
        <div className="page-eyebrow">My Pay</div>
        <h1 className="page-title">My Pay</h1>
        <p className="page-caption">
          Claim your salary with a zero-knowledge proof generated in this browser.
          Your salary amount never leaves this device.
        </p>
      </div>
      {error && <p className="err">{error}</p>}

      <section className="card space-y-4">
        <div>
          <label className="label" htmlFor="employee-id">
            Employee ID
          </label>
          <div className="flex gap-2">
            <input
              id="employee-id"
              type="number"
              min={1}
              className="input w-32"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              disabled={busy}
            />
            <button className="btn" onClick={fetchClaimable} disabled={busy}>
              Fetch claimable salary
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-5">
            Demo input — in production this comes from your session.
          </p>
        </div>

        {claimData && (
          <div className="rounded-md border border-line bg-ground p-4">
            <p className="text-xs text-ink-4">Claimable salary</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
              {fmtMicro(claimData.amountMicro)}
            </p>
            <button
              className="btn-primary mt-4"
              onClick={claimPrivately}
              disabled={busy}
            >
              Claim privately — prove in this browser
            </button>
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-3 rounded-md border border-line bg-ground p-4">
            <ProgressRing
              fraction={STAGE_FRACTION[phase.step] ?? 0.1}
              spinning
              size={22}
            />
            <p className="text-sm text-ink-2">{STATUS_TEXT[phase.step]}</p>
          </div>
        )}

        {phase.step === "claimed" && (
          <div className="rounded-md border border-[#3f7d5c]/40 bg-[#3f7d5c]/[0.08] p-4">
            <p className="text-sm font-medium text-pos">
              Salary claimed privately
            </p>
            <p className="mt-1 text-xs text-ink-4">
              Proof was generated on this device; only the proof was submitted.
            </p>
            <p className="mt-2 font-mono text-xs break-all text-ink-3">
              tx: {phase.txid}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
