# Aragorn — Canton, rebuilt on public Ethereum

> Private institutional settlement on Ethereum: each institution runs a sovereign **Ring**
> (the participant-node of Canton, reborn), workflows compile to ZK circuits, and the chain
> sees nothing but gray rings — commitments, nullifiers, and a verified proof.
> *Keep it secret, keep it safe.*

Built at ETHGlobal New York 2026.

## What it does

A viewer watches, end to end (~10 min): two institutions (UBS as repo dealer, DRW as
lender) onboard with **email login** (Privy — no wallets anywhere, by design), whitelist
each other by **ENS name** (ENSv2 on Sepolia, resolved live), shield USDC into private
notes, and run a **full repo lifecycle**: the dealer books $5M overnight vs a Goldman bond
(four-eyes approval folds into the booking), collateral locks by proof, the proposal lands
in the lender's inbox **via the chain itself**, one atomic DvP settles the on-leg, a
time-warp later the maturity cron closes it automatically — principal + interest **computed
inside the circuit** (a wrong number cannot verify), collateral released by
authority-from-contract (the lender does nothing and *needs* to do nothing). Payroll runs
as a private fan-out; each employee claims their salary with a ZK proof **generated in
their own browser**. An auditor sees everything with a scoped key; the public sees rings.

## Architecture

```
┌─ apps/dashboard ─ Next.js reference client (Privy login → Biscuit session; capability-driven)
│
├─ apps/ring ────── THE PRODUCT: one node per institution (Hono + Postgres, runs on Node)
│    • /v1 REST API ("Ledger API-lite") — every UI action is an API call, curl-able
│    • policy engine: roles, per-user limits, four-eyes approvals, ENS counterparty whitelist
│    • note manager: coin selection, change, encumbrance, contention (Canton-style errors)
│    • prover queue: Noir witness → UltraHonk proof (bb.js in-process)
│    • sync engine: tails Settled events, view-tag scan, decrypts ITS notes only
│    • Postgres = DISPOSABLE CACHE: `POST /v1/resync` wipes it and rebuilds from chain
│    • CCIP-Read gateway: signs employee-subname resolutions (cat.ubs.aragornrings.eth)
│
├─ apps/coordinator ─ deliberately tiny: a relayer that pays gas (institutions never hold ETH)
│
├─ contracts ─────── NoteRegistry (Poseidon2 incremental Merkle tree, depth 32, root ring
│    buffer 64, nullifier set, per-circuit verifier registry, settle()) + ShieldVault (USDC
│    custody) + 8 vendored UltraHonk Solidity verifiers — local Anvil
│
├─ circuits ──────── 8 Noir circuits (cash_shield/transfer/unshield/fanout,
│    entitlement_claim, repo_propose_allocate/accept/close), shared aragorn_lib gadgets
│
└─ packages/protocol ─ the canonical spec in code: commitments, nullifiers, Merkle mirror,
     ECIES envelopes (X25519 + XChaCha20, view tags), Schnorr party signatures, settle ABI
```

Three planes: **settlement** = local Anvil (chain id 31337, MockUSDC); **identity** = real
ENS on Sepolia (ENSv2); **public treasury** = real Base (Privy Earn → Morpho yield).

## The protocol in five lines

```
payload_hash      = Poseidon2(template fields)            # Cash, BondPosition, RepoProposal, …
stakeholders_hash = Poseidon2(sorted party pubkeys)
commitment        = Poseidon2([template_id, version, payload_hash, stakeholders_hash, salt])
nullifier         = Poseidon2([commitment, note_secret])  # note_secret shared with ALL stakeholders
settle(circuitId, proof, [root, T, n1..n4, c1..c4, aux1..aux4], ciphertexts[])
```

`note_secret` travels encrypted to every stakeholder — that is what makes
**authority-from-contract** possible: at repo close, the dealer legitimately consumes the
*lender's* encumbered collateral because the circuit proves the governing agreement is being
exercised correctly. Authority flows from contracts, not just keys — the one abstraction
that separates this from every shielded-payments design.

## Run it

```bash
# prerequisites: bun, node ≥ 24, docker, foundry, nargo 1.0.0-beta.21, bb 5.0.0-nightly.20260324
bun install
make p0   # toolchain gate: prover pipeline + Poseidon2 three-way byte-equality
make p1   # circuits + contracts + scripted shield→transfer→unshield (real proofs)
make p2   # two Rings + relayer: private X1 payment via curl, sync convergence, resync
make p3   # Privy→Biscuit, four-eyes, live Sepolia ENS whitelist, CCIP gateway
make p4   # full repo cycle incl. time-warp auto-close + payroll run/claim
make p5   # Privy Earn (real Base) + in-browser claim proving
make demo # demo-reset → the full 10-minute script against a running stack
```

Secrets live in `.env.local` (see `.env.example`).

## Sponsor integrations

### ENS — the entire identity layer (there are no accounts, only names)
- **ENSv2 on Sepolia, natively**: `aragornrings.eth` registered through the v2 ETHRegistrar
  (commit-reveal), org records on an owner-deployed **PermissionedResolver** proxy
  (VerifiableFactory + Enhanced Access Control role bitmaps), org subnames
  (`ubs.aragornrings.eth`, `drw.aragornrings.eth`) resolved via v2's
  deepest-resolver-wins **wildcard** — text records carry each Ring's encryption pubkey,
  API endpoint, and party root. Counterparty whitelisting resolves these live.
- **CCIP-Read employee subnames**: `cat.ubs.aragornrings.eth` is served by a gateway *inside
  the Ring* (ERC-3668; the resolver pins the org's signing key, so even a hosted gateway
  can't forge records). Employee labels are capabilities, not a directory.
- Product rule: **no hex anywhere in the UI**.

### Privy — auth, the funding wallet, and the yield feature
- Email login → server-verified token → short-lived **Biscuit** session carrying the user's
  entitlements (one policy path for humans and machines). Domain-allowlisted invites;
  test-account mode for reliable live demos.
- **Privy Earn**: the public treasury buffer earns real yield (Gauntlet Morpho vault, USDC
  on Base) through a Privy server wallet — deposit/withdraw/APY live in the dashboard. The
  private-strategies card sits greyed beside it: roadmap, by design.

### World — ProveKit (Track D)
- The payroll claim (`entitlement_claim`) is deliberately **Poseidon-only** (secret-knowledge
  auth, no curve ops) so it compiles through ProveKit's Noir→R1CS pipeline; the booth demo
  proves it **in-browser via WHIR** with off-chain verification, while the same circuit's
  UltraHonk proof settles on-chain ("your salary never leaves your device").

## Honest scaffolding (PoC simplifications, named in the demo)
Per-circuit verifiers (no kernel recursion yet — the anonymity-set unification is narrated,
not implemented), ciphertexts in events (not blobs), one shared relayer, software keys (no
HSM/FROST), dev trusted setup n/a (UltraHonk needs none), local Anvil as the settlement
chain. The roadmap is the production design in `EXPLORATION.md`.
