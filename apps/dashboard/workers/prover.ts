// Web worker: in-browser witness execution + UltraHonk proving for the
// entitlement_claim circuit. The claim secret and salary amount never leave
// the device — only the proof and its public inputs go back to the page.

import type { CompiledCircuit } from "@noir-lang/noir_js";
import {
  buildClaimWitness,
  initPoseidon,
  proveClaim,
  type ClaimData,
} from "../lib/claimProver";

export type ProverStage =
  | "loading-circuit"
  | "executing-witness"
  | "proving"
  | "done";

export type ProverRequest = { type: "prove"; claimData: ClaimData };

export type ProverResponse =
  | { type: "progress"; stage: ProverStage }
  | { type: "done"; proof: string; publicInputs: string[] }
  | { type: "error"; message: string };

const post = (msg: ProverResponse) => self.postMessage(msg);

self.onmessage = async (e: MessageEvent<ProverRequest>) => {
  if (e.data?.type !== "prove") return;
  try {
    post({ type: "progress", stage: "loading-circuit" });
    const res = await fetch("/circuits/entitlement_claim.json");
    if (!res.ok) throw new Error(`failed to load circuit artifact (HTTP ${res.status})`);
    const artifact = (await res.json()) as CompiledCircuit;

    await initPoseidon();
    const { inputs } = buildClaimWitness(e.data.claimData);

    const bundle = await proveClaim(artifact, inputs, (stage) =>
      post({ type: "progress", stage }),
    );

    post({ type: "done", proof: bundle.proof, publicInputs: bundle.publicInputs });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
