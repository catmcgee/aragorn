# World Track D (ProveKit) booth demo — payroll claim

**Date:** 2026-06-12 · **Status: QUALIFIES (CLI level).** Noir → R1CS → WHIR proof
generated and verified locally with ProveKit v1. Browser (Verity WASM) path blocked
by a PKP file-format version mismatch — details at the bottom.

## What this proves

The Track D statement: a recipient claims a private payroll entitlement. The circuit
(`payroll_claim/src/main.nr`) is a standalone, Noir-beta.11-compatible port of
`circuits/entitlement_claim` (helpers from `circuits/lib` inlined; no Schnorr — this
circuit is Poseidon-only by design, which is exactly why it ports to R1CS):

- authorization: `claim_hash = Poseidon2([claim_secret])`
- entitlement commitment: `H5([6, 1, H4([claim_hash, amount, payer_x, memo_hash]), H4([payer_x,0,0,0]), salt])`
- Merkle membership: 32-level root recompute (index bits pick left/right)
- nullifier: `H2([commitment, ent_secret])`
- conservation: output cash note `H5([1, 1, H3([out_owner_x, amount, out_salt2]), H4([out_owner_x,0,0,0]), out_salt])` carries the exact claimed amount

Public inputs simplified to `(root, nullifier_out, cash_commitment_out)` — the booth
demo doesn't need the on-chain 14-slot layout.

## Toolchain

| Piece | Version / source |
|---|---|
| ProveKit CLI | `cargo install provekit-cli --version 1.0.0 --locked` (stable, audited v1; bundles its own Noir **1.0.0-beta.11-alpha.4** frontend — no separate nargo needed) |
| Poseidon2 in-circuit | `poseidon = { tag = "v0.1.1", git = "https://github.com/noir-lang/poseidon" }` — the CLI's bundled stdlib marks `std::hash::poseidon2` **private**, so the beta.11 stdlib path does not compile; the external lib produces hashes identical to `@aztec/bb.js` (verified: proof public inputs match the bb.js-computed values bit-for-bit) |
| Witness generation | `gen-prover-toml.ts` (bun + `packages/protocol` poseidon2 via `@aztec/bb.js`); 1-leaf tree at index 0, siblings = zero-subtree chain z0=0, z_{i+1}=H2([z_i,z_i]) — same trick as `apps/dashboard/scripts/test-prove.ts` |

Note: the bundled frontend also rejects **non-ASCII characters in comments** (em
dashes, arrows). Keep `.nr` source pure ASCII.

## Exact commands

```bash
# 1. install (one-time, ~9 min build)
cargo install provekit-cli --version 1.0.0 --locked

# 2. witness values (from repo root)
bun spikes/provekit-booth/gen-prover-toml.ts     # writes payroll_claim/Prover.toml

# 3. compile + keys (run IN the Noir crate dir)
cd spikes/provekit-booth/payroll_claim
provekit-cli prepare . --pkp app.pkp --pkv app.pkv

# 4. prove + verify
provekit-cli prove --prover app.pkp --input Prover.toml --out proof.np
provekit-cli verify --verifier app.pkv --proof proof.np   # exit 0 = valid
provekit-cli show-inputs --hex app.pkv proof.np           # named public inputs
provekit-cli circuit-stats target/payroll_claim.json      # R1CS breakdown
```

## Results

| Metric | Value |
|---|---|
| prepare (compile + R1CS + keys) | **1.10 s** wall |
| **prove (WHIR)** | **0.22 s** wall (~35 MB peak memory) |
| **verify** | **0.04 s** wall (~16 MB peak memory) |
| proof size (`proof.np`) | **589,064 bytes** (~576 KB, Zstd-compressed container) |
| prover key `app.pkp` | 253,180 bytes |
| verifier key `app.pkv` | 170,566 bytes |

R1CS stats (`circuit-stats`):

| Stat | Value |
|---|---|
| ACIR | 555 witnesses, 539 opcodes |
| R1CS constraints | **12,935** (2^13.66) |
| R1CS witnesses | **17,331** (2^14.08) |
| Poseidon2 permutations | 45 calls → 12,060 constraints (93% — Poseidon2Permutation is a supported blackbox in the R1CS lowering) |
| AssertZero | 271 constraints |
| Matrix sparsity | A 109,322 / B 203,344 / C 13,538 entries |

Soundness spot-checks (both behave correctly):
- bit-flipped `proof.np` → `verify` exits 1
- wrong `claim_secret` in Prover.toml → `prove` itself fails (witness unsatisfiable)
- `show-inputs` returns root / nullifier_out / cash_commitment_out exactly matching
  the bb.js-side computation in `gen-prover-toml.ts`

## Browser path (Verity) — blocked, documented

Attempt: `bun add @atheonxyz/verity@0.3.2-alpha @noir-lang/noir_js@1.0.0-beta.11
@noir-lang/acvm_js@1.0.0-beta.11`, then `verity-prove.ts` (loads `app.pkp`/`app.pkv`
bytes, `Verity.create(Backend.ProveKit)` → `loadProver` → `prove(ProverToml)` →
`verify`). The SDK loads fine in bun, but `loadProver` throws:

```
Incompatible prover format: minor version 1, expected >= 2
```

provekit-cli **1.0.0** writes PKP container format **major=1 minor=1**; the Verity
WASM bundle (both published versions, `0.3.2-alpha` and `0.3.2-beta` — the only two
on npm) is built against ProveKit **main** (Noir beta.19), which bumped the PKP
format to minor 2. No published provekit-cli emits the minor-2 format (1.0.0 is the
only 1.x on crates.io), and `prepare` has no format flag. Bridging would mean
building ProveKit from git main and re-porting the circuit to beta.19 — out of scope
for the booth bar; CLI-level already qualifies. The unblock is upstream: either a
provekit-cli release that writes PKP minor 2, or a Verity build pinned to the v1
format.

## Files

- `payroll_claim/` — Noir crate (`src/main.nr`, `Nargo.toml`, `Prover.toml`, `app.pkp`, `app.pkv`, `proof.np`)
- `gen-prover-toml.ts` — witness generator (bun, bb.js Poseidon2)
- `verity-prove.ts` — browser-path attempt (currently blocked as above)
- `cargo-install.log` — provekit-cli build log
