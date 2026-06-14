# Groth16 settlement — migration plan

## TL;DR

We have now demonstrated, on local Anvil, that Aragorn's `NoteRegistry.settle(...)`
can route a **real Groth16 proof** through its normal `IVerifier` seam and verify it
on-chain (positive verifies, tamper reverts). See `## What was built on Anvil`.

The honest gap: the Groth16 verifying key we have is for the **spike circuit** (one
public signal, the WHIR public-input commitment), **not** any real Aragorn
note-transition circuit. Making the production cash/repo circuits actually settle via
Groth16 requires re-running the ProveKit → recursive-Groth16 pipeline **per settlement
circuit** (a one-time ~20M-constraint trusted setup each, on a ≥64GB-RAM machine that
no longer exists), swapping the Ring's prover from bb.js UltraHonk to a ProveKit
prover, binding the 14 settlement public inputs into the Groth16 statement, and
redeploying (the registry freeze means a fresh deploy). That is the work below.

---

## What was built on Anvil (the achievable, genuine integration)

Files added (all in this worktree, branch `groth16-settlement-anvil`):

- `contracts/src/groth16/Groth16VerifierBase.sol` — the gnark-exported Groth16
  verifier vendored from `spikes/provekit-groth16/onchain/src/Verifier.sol` (the
  **patched** copy, with the SHA-256 / RFC-9380 `hashToField` fix the team applied;
  see `spikes/provekit-groth16/ONCHAIN_RESULT.md`). Contract renamed
  `Verifier` → `Groth16VerifierBase` to avoid clashing with the per-circuit UltraHonk
  `*Verifier` contracts. The pairing and the embedded VK are untouched.
- `contracts/src/groth16/Groth16Verifier.sol` — a thin `IVerifier` adapter. It
  ABI-decodes `settle`'s `proof` bytes (13 packed uint256 words) into the gnark
  `verifyProof(uint256[8],uint256[2],uint256[2],uint256[1])` shape, `staticcall`s the
  base (which reverts on a bad proof), and returns `true` iff it did not revert —
  matching `IVerifier`'s bool contract. No change to `NoteRegistry` or app callers.
- `contracts/script/DeployGroth16.s.sol` — deploy **variant** (not production
  `Deploy.s.sol`): stands up a fresh registry, registers the adapter under
  `circuitId = 100`, freezes.
- `contracts/test/Groth16Settle.t.sol` — 4 tests proving the seam end-to-end.
- `contracts/test/fixtures/` — copied spike proof + public input (read-only refs).

Results:

- `forge build` clean (only pre-existing lint warnings from the UltraHonk verifiers).
- `forge test`: **12/12 pass** (8 pre-existing + 4 new).
- Live Anvil (`--port 8547`) via `DeployGroth16`:
  - `NoteRegistry.settle(100, realProof, 14-inputs, [])` → **status `0x1`**,
    gasUsed `0x17ed58` ≈ **1.57M** (of which ~340k is the Groth16 verify; the rest is
    the 32-level Poseidon2 Merkle insert that every `settle` does).
  - Tampered proof → reverts **`registry: invalid proof`** (the adapter returned
    `false` because the gnark verify reverted `ProofInvalid()`).
  - Adapter `verify(goodProof, inputs)` via `cast call` → `true`.

### The honest constraint, restated in code

`Groth16Verifier.sol` deliberately carries the Groth16 public signal **inside** the
`proof` blob rather than reconstructing it from the registry's 14 public inputs,
because the spike VK's single signal is not bound to a real note transition. This is
**Anvil-only**, wired via a deploy variant, and the limitation is documented in the
contract's NatSpec. Do **not** read this as "existing UltraHonk settlement proofs now
verify under Groth16" — they cannot; a Groth16 verifier only accepts proofs produced
against its own circuit + proving key.

---

## Production migration: making the real cash/repo circuits settle via Groth16

Aragorn has **10 settlement circuits** (`circuits/`): `cash_shield`, `cash_transfer`,
`cash_unshield`, `cash_fanout`, `entitlement_claim`, `repo_propose_allocate`,
`repo_accept`, `repo_close`, `strategy_open`, `strategy_redeem`. Each is Noir today,
compiled and proved with bb.js UltraHonk (`packages/protocol/src/prover.ts::prove`),
with a per-circuit `*Verifier.sol` registered in `contracts/script/Deploy.s.sol`.

To move a circuit to Groth16 settlement:

### Step 1 — Provision a ≥64GB-RAM build box (one-time per setup run)
The recursive Groth16 wrap of a ProveKit/WHIR proof of a real settlement circuit is a
~20M-constraint statement. gnark Groth16 `Setup` on that needs **≥64GB RAM** (the VM
we used was deleted). Re-provision a comparable box (e.g. a 64–128GB cloud VM).
- **Effort:** ~1–2h to provision + install the ProveKit fork + gnark toolchain.
- **Cost:** a 64–128GB VM is ~$1–3/hr spot; the setup work is bursty, call it
  low single-digit dollars/hr while running.

### Step 2 — Run ProveKit Setup per settlement circuit (the heavy one-time cost)
For **each** of the 10 circuits you want Groth16-settled:
1. Compile the Noir circuit through the **ProveKit/WHIR** path (not bb.js).
2. Build the recursive-Groth16 wrapper circuit (`recursive-verifier/app/circuit`)
   around that ProveKit proof.
3. Run `groth16.Setup` → proving key + verifying key (`vk.bin`).
   - **Time:** the spike noted re-proving alone was a ~45-min VM job; full Setup on a
     20M-constraint circuit is on that order or larger (tens of minutes to ~hours per
     circuit, memory-bound). Budget **~1 hour per circuit** for Setup, plus iteration.
   - This is a **trusted setup** per circuit. For a demo/testnet a single-party setup
     is acceptable; for anything production-credible you need a **proper MPC ceremony**
     per circuit (Phase-2), which is a meaningful operational + coordination effort.
- **Effort (all 10):** a focused 1–3 day job once the box and pipeline are working;
  most of it is wall-clock Setup time, not hands-on.
- **What's hard / risky:** memory headroom (OOM kills are the failure mode), Setup
  reproducibility, and securely retaining/destroying setup toxic waste.

### Step 3 — Generate a per-circuit Groth16 verifier
For each circuit, `vk.ExportSolidity` → a per-circuit `Groth16VerifierBase`-style
contract. **Apply the same HashToField patch** we used in the spike (RFC-9380
`expand_message_xmd(SHA-256)`, DST `"bsb22-commitment"`), OR re-prove with
`backend.WithProverHashToField(keccak256)` to match the stock template — prover and
verifier MUST agree (this was the one real bug in the spike;
`ONCHAIN_RESULT.md §"The one real bug"`). Wire each into a per-circuit instance of the
`Groth16Verifier` adapter (the adapter is circuit-agnostic; only the base VK changes).
- This effectively becomes a Groth16 sibling of `scripts/gen-verifiers.sh` (which
  today runs `bb write_solidity_verifier --scheme ultra_honk`).

### Step 4 — Bind the 14 settlement public inputs into the Groth16 statement
This is the **most important correctness step** and what makes it a real settlement
rather than the spike. Today `NoteRegistry.settle` enforces semantics on the 14 inputs
`[root, t, n1..n4, c1..c4, aux1..aux4]` (known root, nullifier non-replay, commitment
insert, vault side-effects) and trusts the verifier to bind the proof to *those exact
inputs*. The UltraHonk verifiers do this: they take `publicInputs` directly.

The recursive-Groth16 path collapses everything to **one** Groth16 public signal (the
WHIR public-input commitment). So you must:
1. Make the inner ProveKit/WHIR circuit expose the 14 settlement values as its public
   inputs (same layout/order as `prover.ts` `ProofBundle.publicInputs`).
2. Make the recursive wrapper's single Groth16 public signal be a **binding
   commitment to those 14 values** (e.g. the WHIR public-input commitment over them).
3. Change the **adapter** so it **reconstructs** that commitment from `settle`'s 14
   `bytes32[] publicInputs` and passes it as `input[0]` to `verifyProof` — instead of
   trusting a value embedded in the proof blob (which is the Anvil-spike shortcut).
   This is the line in `Groth16Verifier.sol` to replace; the NatSpec flags it.
- **What's hard / risky:** getting the commitment scheme identical on both sides
  (field element packing, ordering, domain separation). A mismatch here is a *silent*
  soundness hole if you're not careful — the proof would verify against the wrong
  binding. Needs careful test vectors: prove a known transition, assert the
  reconstructed `input[0]` equals the prover's signal.

### Step 5 — Swap the Ring prover from bb.js UltraHonk to ProveKit
In `packages/protocol/src/prover.ts`, `prove()` currently calls
`UltraHonkBackend.generateProof(..., { verifierTarget: 'evm' })` and returns
`{ proof, publicInputs }`. Replace with a ProveKit prover that:
- runs witness gen, produces the WHIR proof, then the recursive Groth16 wrap;
- returns the proof in the **13-word packed layout** the adapter decodes (8 proof + 2
  commitments + 2 commitmentPok + 1 signal), and the same 14 `publicInputs`.
- Keep the `ProofBundle` shape so `apps/ring/src/flows.ts` (the `prove(...)` call
  sites and the relayed `settle`) needs no changes. The prover queue
  (`flows.ts` concurrency-1) stays as is.
- **What's hard / risky:** ProveKit proving in the Ring's runtime (Node/worker) —
  bb.js is WASM-friendly; the ProveKit recursive prover is heavier (native/Rust + gnark
  Go). Likely needs an out-of-process prover service the Ring calls, not in-process
  WASM. Per-proof latency will be **higher** than UltraHonk (recursion is expensive to
  *prove*, cheap to *verify*) — the win is on-chain gas, not prover time.

### Step 6 — Redeploy (the freeze forces it) and register the new verifiers
`Deploy.s.sol` calls `registry.freezeVerifiers()`, and `setVerifier` reverts once
frozen — so you **cannot** hot-swap verifiers. Migration is a **fresh `NoteRegistry`
deploy** that registers the new Groth16 adapters (per circuit) under the existing
circuitIds (1–10), then freezes. This is a new deployment with a new registry address;
the Ring config + `deployments.*.json` + any seeded state must point at the new
registry. (You can migrate incrementally: register Groth16 for the high-volume
circuits, keep UltraHonk for the rest, in one fresh deploy.)

---

## Where to start (highest ROI)

Pick the **largest / most frequent UltraHonk verify** first — likely `cash_transfer`
(high volume) — where the recursion win compounds. UltraHonk-keccak verify of these
circuits costs hundreds of thousands to >1M gas with a large verifier contract;
the Groth16 verify is a **fixed ~340k gas, constant-size, 12-word-calldata** check
regardless of inner circuit size. Prove one circuit end-to-end (Setup → verifier →
binding → prover → redeploy → real `settle`), validate the binding with test vectors,
then fan out to the rest.

## Rough overall effort / cost

- **Pipeline + first circuit, fully bound and settling for real:** ~1–2 focused weeks
  (the Step-4 binding and Step-5 prover swap are the bulk; Setup is wall-clock, not
  effort).
- **Remaining 9 circuits:** mostly repeating Steps 2–3 (Setup + verifier gen) + a
  binding test each → ~3–5 additional days, dominated by Setup wall-clock.
- **Infra cost:** a few hundred dollars of 64–128GB VM time across all setups +
  iteration; negligible per-proof and on-chain costs after.
- **Biggest risks:** (1) the 14-input → Groth16-signal binding being subtly wrong
  (soundness); (2) running a credible per-circuit MPC ceremony if this needs to be
  production-trustworthy; (3) ProveKit prover integration/latency in the Ring runtime.

## Bottom line

This gets us to **"the settlement contract verifies real Groth16 proofs on-chain
through its normal `settle` path"** — proven on Anvil. It does **not** yet get us to
**"live settlement of real cash/repo transitions uses Groth16"**; that gap is entirely
the per-circuit ProveKit Setup + the 14-input binding + the prover swap above, all of
which need the (now-deleted) ≥64GB box re-provisioned.
