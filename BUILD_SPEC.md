# Aragorn — BUILD_SPEC

*Agent-executable addendum to PLAN.md. PLAN.md says what and why; this file says exactly how. Where the two disagree, BUILD_SPEC wins for implementation detail; PLAN wins for scope intent.*

> **AMENDMENTS (2026-06-12, build start — supersede conflicting text below):**
> 1. **No mainnet fork** (user decision): settlement chain = plain local Anvil (chain id 31337). USDC = a `MockUSDC` ERC-20 we deploy (6 decimals); seed script mints instead of impersonating a whale. All "Anvil mainnet fork" / `FORK_BLOCK` / whale references are void. Identity stays on Sepolia ENS; Privy Earn stays on real Base.
> 2. **Package manager/runtime = bun** (user decision), not pnpm.
> 3. **Prover = Barretenberg/UltraHonk** (spec's own fallback, triggered): ProveKit cannot produce EVM-verifiable proofs today (WHIR-native; Groth16 wrap has no Solidity export — worldfnd/provekit#447 open). bb.js proves server-side and in-browser; bb writes Solidity Honk verifiers. ProveKit is retained ONLY as the World Track D booth demo: in-browser WHIR proving of `entitlement_claim` with off-chain verification (allowed by the track rules). See DECISIONS.md D-001.

---

## 0. Build target (DECIDED)

Build the **Demo Target**: every flow the demo and sponsor booths touch is fully functional; everything else is greyed, navigable roadmap UI (PLAN §6).

**Functional set:**
- Onboarding: Ring provisioning, Privy email auth, invites, roles/entitlements, Biscuits (I1)
- ENS: org/department names on Sepolia, counterparty whitelist by name, CCIP-Read employee subname gateway (I4)
- Shield/unshield USDC (I2, B3)
- Internal department transfer with four-eyes (I3)
- Payroll: fan-out + claim, with ProveKit **browser** proving for the claim (I6)
- Repo full cycle: propose+allocate → accept (atomic DvP) → time-warp → auto-close (X4)
- Private Ring→Ring payment (X1 — free byproduct of cash_transfer)
- Privy Earn on the public funding wallet, real chain (B2) — **the yield feature** (Earn allocates to Morpho under the hood; say "yield via Morpho through Privy Earn")
- Auditor viewing access + export (I5)
- Public-view split panel (reads chain directly)

**NOT built (seeded or greyed):**
- Bond issuance/DvP circuits (`bond_issue`, `bond_dvp_accept`) — the bond position is **seeded** directly into the tree by the seed script as if issued by Goldman Sachs
- `repo_default` circuit — greyed button
- Bond coupons (X3) — greyed; payroll carries the fan-out circuits
- **Private DeFi strategies (B1) — greyed card on Strategies** ("Roadmap: private strategies — shielded cash into Morpho/Aave/Uniswap, position held as a private note"). Cut per decision: Privy Earn already allocates to Morpho, so the live yield story doesn't need our own adapter. Cuts `strategy_deposit`/`strategy_withdraw` circuits, MorphoAdapter.sol, and the fork-Morpho dependency entirely (fork is now needed only for real USDC).
- All roadmap pages per PLAN §6 (Lending, FX, Compliance, Reports + in-page greys)

**Circuits in target (8):** `cash_shield`, `cash_transfer`, `cash_unshield`, `cash_fanout`, `entitlement_claim`, `repo_propose_allocate`, `repo_accept`, `repo_close`.

---

## 1. Versions & toolchain (P0 gate)

Resolve exact versions at build start (APIs churn); record choices in `VERSIONS.md` at repo root. **Proving stack decision: Groth16 via ProveKit is PRIMARY for all 8 circuits** (one pipeline browser + server, tiny standard on-chain verifiers, maximal World Track D alignment); **bb/UltraHonk is the wholesale fallback** (circuits are backend-agnostic Noir — flipping is a half-day). The P0 gate decides: a Noir circuit must compile to R1CS (ProveKit), prove (CLI/Node and browser), export/derive a Solidity Groth16 verifier, and verify on Anvil — before ANY dependent work starts. Groth16 trusted setup = dev-mode ceremony for the PoC (honest footnote; real ceremony is production scope).

| Tool | How to pin |
|---|---|
| Noir (`nargo`) | `noirup` latest stable 1.x; check noir-lang.org compatibility table for the matching bb version |
| ProveKit | **Primary prover, all circuits** (Noir → R1CS → Groth16; browser via WASM bundle, server via CLI/bindings). Read https://docs.provekit.atheon.xyz/ at build start |
| Barretenberg (`bb` CLI + `@aztec/bb.js`) | **Fallback prover** — pinned per Noir compatibility table; generates Honk Solidity verifiers if the P0 ProveKit gate fails |
| Foundry | latest stable (`foundryup`) |
| Node | 22 LTS; pnpm 9; turborepo latest |
| `@privy-io/react-auth`, `@privy-io/server-auth` | latest; Privy dashboard app created at build start |
| `biscuit-wasm` | latest npm release (Biscuit v2 tokens) |
| viem | latest |
| `@noble/curves`, `@noble/ciphers` | latest (X25519 + XChaCha20-Poly1305) |
| Drizzle + postgres | latest; Postgres 16 via docker |
| Next.js | latest stable App Router; shadcn/ui; Tailwind |

**Resolve-at-build-time list** (read live docs, write findings to `DECISIONS.md`):
1. bb.js Schnorr signing API over Grumpkin (see §3.4 — fallback specified)
2. ProveKit: Noir→R1CS support surface (which stdlib functions compile — decides Schnorr vs secret-auth §3.4), Groth16 Solidity verifier export, server-side proving mode (CLI vs bindings), browser bundle, proving time for the largest circuit (repo_accept) — **this is THE P0 spike**
3. Privy Earn API: supported chains/assets, server wallet integration (https://docs.privy.io/wallets/actions/earn/overview)
4. ENS Sepolia: registrar controller address, registration flow; CCIP-Read reference: https://github.com/ensdomains/offchain-resolver
5. Anvil fork block number: recent; post-check that a USDC whale (any top holder from Etherscan) has balance at that block; record in `DECISIONS.md`
6. Poseidon2 Solidity implementation with Barretenberg parameters (see §3.1 fallback if none)

---

## 2. Repo layout & bootstrap order

```
/ (pnpm + turborepo)
├─ VERSIONS.md, DECISIONS.md, PLAN.md, BUILD_SPEC.md, EXPLORATION.md
├─ circuits/
│  ├─ lib/                  # shared Noir lib: note gadgets (crate name: aragorn_lib)
│  └─ <circuit_name>/       # one crate per circuit (8)
├─ contracts/               # Foundry
│  ├─ src/NoteRegistry.sol, ShieldVault.sol
│  ├─ src/verifiers/        # generated, vendored (committed)
│  └─ test/, script/Deploy.s.sol
├─ packages/
│  ├─ protocol/             # THE canonical spec in code (§3). No deps on apps.
│  └─ sdk/                  # typed client for Ring API
├─ apps/
│  ├─ ring/                 # node service (Hono + Drizzle + ProveKit prover; bb.js fallback)
│  ├─ coordinator/          # relayer + provisioning (directory = ENS; no relay needed, see §6.4)
│  ├─ gateway/              # CCIP-Read resolver server (can live inside ring/; separate route ok)
│  └─ dashboard/            # Next.js
├─ infra/docker-compose.yml # anvil-fork, postgres x2, ring x2, coordinator, dashboard
└─ scripts/                 # deploy.sh, seed.ts, demo-reset.sh, warp.sh
```

**Build order (each step has a runnable gate, §8):**
P0 toolchain+protocol → P1 circuits(core 3)+contracts → P2 ring core → P3 identity/ENS/dashboard shell → P4 repo+payroll circuits+flows → P5 strategies+Earn+ProveKit → P6 greys+polish+seed+demo script.

---

## 3. Protocol constants — single source of truth

`packages/protocol` implements ALL of this; circuits and contracts conform to it; e2e tests assert byte-equality between TS, Noir, and Solidity implementations (P1 gate).

### 3.1 Field & hash
- Field: BN254 scalar field. All protocol values are field elements unless stated.
- Hash: **Poseidon2** as implemented by the pinned Barretenberg (`poseidon2Hash` in bb.js == `std::hash::poseidon2` in Noir). TS MUST use bb.js's implementation — never a third-party Poseidon (parameter mismatch is the classic burn).
- **Solidity is the hash-compat risk** (the on-chain tree needs the same hash): the P0 spike must find/port a bb-parameter Poseidon2 Solidity implementation and pass the three-way byte-equality fixture. **Specified fallback if none works within a half-day: switch the whole protocol to classic circom-parameter Poseidon** — Noir stdlib `poseidon`, TS `poseidon-lite`, Solidity `poseidon-solidity` are a known-compatible trio. One constant swap in packages/protocol + circuits/lib; nothing else changes. Decide ONCE in P0, record in DECISIONS.md.

### 3.2 Template IDs (u32)
```
1 = Cash    2 = BondPosition    3 = RepoProposal    4 = CollateralAllocation
5 = RepoAgreement    6 = Entitlement    7 = (reserved: StrategyPosition — roadmap)
```
`version = 1` everywhere.

### 3.3 Note structure
```
payload_hash      = Poseidon2(template-specific fields, fixed order per §3.6)
stakeholders_hash = Poseidon2(sorted ascending party pubkey x-coordinates, padded with 0 to 4)
commitment C      = Poseidon2([template_id, version, payload_hash, stakeholders_hash, salt])
nullifier  N      = Poseidon2([C, note_secret])
```
- `salt`, `note_secret`: random field elements, generated by creator, included in encrypted payload to ALL stakeholders (note_secret must be stakeholder-derivable — authority-from-contract spends, EXPLORATION §2.1).
- Contract ID (API layer): `cid = "0x" + hex(C)`.

### 3.4 Parties & signatures
- Party keypair: **Grumpkin** (BN254's embedded curve). Pubkey = (x, y); protocol uses x with a sign byte.
- Signature: Schnorr per Noir stdlib `schnorr` (verify in-circuit); sign in TS via bb.js Schnorr module.
- **Fallback if bb.js Schnorr signing is unavailable in the pinned version** (resolve in P0 spike): replace signature auth with **secret-knowledge auth** everywhere: each party-owned note carries `owner_auth_hash = Poseidon2(owner_secret)`; spending proves knowledge of `owner_secret`. Weaker (no per-transition binding) but acceptable for PoC; record in DECISIONS.md. Either way:
- **`entitlement_claim` ALWAYS uses secret-knowledge auth** (`claim_hash = Poseidon2(claim_secret)` in the entitlement payload) — pure Poseidon, guaranteed ProveKit-portable, no curve ops in the browser circuit.
- Signed message for transitions: `msg = Poseidon2([root, all nullifiers..., all commitments...])` (padded arity per circuit).

### 3.5 Amounts, time, interest
- Amounts: `u64`, micro-USDC (6 decimals). $5,000,000 = 5_000_000_000_000.
- Time: unix seconds as `u64` field. Claimed time bound `T` is a public input; NoteRegistry checks per-template flag: `repo_close` requires `block.timestamp >= T` and circuit checks `maturity <= T`; all other circuits pass `T = 0` (unchecked).
- Repo interest (in-circuit, integer math): `repurchase = P + (P * rate_bps * days) / (10_000 * 360)`, all u64, division floor. `days` is a term field agreed in the proposal (overnight = 1) — not derived from clock.

### 3.6 Template payload field orders (exact Poseidon2 input order for payload_hash)
```
Cash:                 [owner_x, amount, salt2]            # salt2: extra randomness, random field
BondPosition:         [owner_x, issuer_x, isin_hash, face_amount, encumbrance]
                      # encumbrance: 0 = free, else = commitment of governing RepoAgreement
RepoProposal:         [dealer_x, lender_x, isin_hash, face_amount, cash_amount, rate_bps, days]
CollateralAllocation: [dealer_x, proposal_C, isin_hash, face_amount]
RepoAgreement:        [dealer_x, lender_x, collateral_C, cash_amount, rate_bps, days, maturity_ts]
Entitlement:          [claim_hash, amount, payer_x, memo_hash]    # claim_hash = Poseidon2(claim_secret)
```
`isin_hash`, `memo_hash`: Poseidon2 of UTF-8 bytes packed into fields (31 bytes/field).

### 3.7 Encryption envelope & discovery
- Per-stakeholder ECIES: ephemeral X25519 → shared secret → XChaCha20-Poly1305.
- Each org has ONE X25519 encryption keypair (in ENS text record `aragorn.encpubkey`); per-stakeholder ciphertexts, not per-party (org node decrypts for all its parties).
- Envelope per recipient: `ephPub(32) ‖ viewTag(4) ‖ nonce(24) ‖ ciphertext`. `viewTag = first 4 bytes of sha256("aragorn-tag" ‖ sharedSecret)`. Sync engine computes expected tag per event with its own key and skips full decryption on mismatch.
- Plaintext: JSON `{templateId, version, fields: {...}, salt, salt2?, note_secret, stakeholders: [partyX...]}` — JSON is fine (cache, not consensus); the commitment binds the canonical values.

### 3.8 `settle()` ABI & public input layout
```solidity
function settle(
  uint32 circuitId,                 // 1..8 — NOT a template id: one circuit may touch many templates
  bytes calldata proof,
  bytes32[] calldata publicInputs,
  bytes[] calldata ciphertexts      // emitted in event, not stored
) external;
```
Circuit IDs: `1 cash_shield, 2 cash_transfer, 3 cash_unshield, 4 cash_fanout, 5 entitlement_claim, 6 repo_propose_allocate, 7 repo_accept, 8 repo_close`. Template IDs (§3.2) live *inside* commitments to type notes; the verifier registry, time-check flag, and vault side effects are keyed by **circuitId**.
Public input order (FIXED, all circuits): `[root, T, n1..n4, c1..c4, aux1..aux4]` — 14 inputs, zero-padded.
- nullifier slots unused → 0 (contract skips); commitment slots unused → 0 (contract skips insertion).
- `aux` per circuit: `cash_shield`: [amount, depositor]; `cash_unshield`: [amount, recipient_addr]; `repo_close`: unused; others 0.
- Contract checks: root ∈ ring buffer (64), nullifiers unseen → mark seen, insert nonzero commitments, time-check flag for T (circuitId 8), call the circuit's verifier from registry, vault side effects for circuitIds 1/3 (§5), emit `Settled(circuitId, nullifiers, commitments, ciphertexts, T)`.

---

## 4. Circuit specs (Noir crate per row; shared gadgets in `aragorn_lib`)

Shared gadgets: `compute_commitment`, `compute_nullifier`, `merkle_check(root, leaf, path[32], index_bits)`, `check_sig(party_x, msg)` (or secret-auth), `assert_conservation`.

Common private inputs for any consumed note: full payload fields + salt + note_secret + merkle path + leaf index.

| Circuit | Consumes (nullifiers) | Creates (commitments) | Constraints enforced |
|---|---|---|---|
| `cash_shield` | — | c1: Cash(owner, amount) | aux.amount == payload.amount (contract pulls USDC) |
| `cash_transfer` | n1,n2: Cash (n2 optional) | c1: Cash(recipient), c2: Cash(change→sender) | owner auth on inputs; in_sum == out_sum; recipient/change owners well-formed |
| `cash_unshield` | n1: Cash | c1: Cash(change) optional | owner auth; aux.amount + change == input amount |
| `cash_fanout` | n1: Cash (funding) | c1..c4: Entitlement | payer auth; Σ entitlement amounts + change(c-slot reuse: last slot = Cash change) == funding; each entitlement carries claim_hash |
| `entitlement_claim` | n1: Entitlement | c1: Cash(owner = claimer) | **Poseidon-only**: knows claim_secret with Poseidon2(claim_secret)==claim_hash; cash.amount == entitlement.amount. ProveKit browser target |
| `repo_propose_allocate` | n1: BondPosition (free) | c1: RepoProposal, c2: CollateralAllocation | dealer auth; allocation fields == proposal collateral fields; bond encumbrance==0 |
| `repo_accept` | n1: Proposal, n2: Allocation, n3,n4: lender Cash | c1: BondPosition(owner=lender, encumbrance=c2), c2: RepoAgreement, c3: Cash(→dealer), c4: Cash(lender change) | lender auth on cash; cash to dealer == proposal.cash_amount; agreement fields copied from proposal; maturity_ts is a private input set by the lender at accept (= chain now + days×86400; dealer's node validates it on decrypt — not circuit-enforced in PoC, DECISIONS note); encumbered position fields == allocation fields |
| `repo_close` | n1: RepoAgreement, n2: encumbered BondPosition, n3,n4: dealer Cash | c1: Cash(→lender, = repurchase), c2: BondPosition(owner=dealer, encumbrance=0), c3: Cash(dealer change) | dealer auth on cash; position.encumbrance == agreement C (authority-from-contract); repurchase formula §3.5; circuit asserts `agreement.maturity_ts <= T` (public T; contract enforces `block.timestamp >= T`) |

Keep every circuit < 50k constraints (no recursion, ≤ 2 Merkle proofs each side where possible — depth-32 Poseidon Merkle ≈ ~8k constraints per proof, fine).

---

## 5. Contracts (Foundry)

**NoteRegistry.sol** — owns the tree (incremental Poseidon2 Merkle, depth 32; use an existing audited incremental-tree pattern ported to Poseidon2 via precompiled hash in Solidity? NO — Poseidon2 in Solidity is expensive but fine on fork; implement from the Barretenberg-compatible Poseidon2 Solidity reference, or simpler: **maintain the tree off-chain and store only roots**? NO — keep it honest: on-chain incremental tree, gas irrelevant on fork). Root ring buffer (64). Nullifier mapping. Verifier registry `circuitId → address` (owner-settable, deploy-time only). `settle()` per §3.8. Circuit flags: `requiresTimeCheck[8]=true (repo_close)`, shield side effects on circuitIds 1/3.

**ShieldVault.sol** — holds USDC. `settle()` with circuitId==cash_shield triggers `transferFrom(depositor, vault, amount)` (depositor pre-approves); cash_unshield triggers `transfer(recipient_addr, amount)`. Only callable by NoteRegistry.

(MorphoAdapter.sol — cut; private strategies are roadmap. Yield = Privy Earn on the funding wallet.)

**Verifiers** — Groth16 verifier contracts per circuit (ProveKit export or standard Groth16 verifier template + per-circuit verifying keys from the dev setup), vendored under `contracts/src/verifiers/`, regenerated by `scripts/gen-verifiers.sh` (CI diffs). (Fallback mode: bb-generated Honk verifiers, same registry interface.)

Foundry tests: tree insertion/root history, nullifier replay revert, a full proof verification fixture per circuit (fixtures produced by a TS script in packages/protocol).

---

## 6. The Ring node (apps/ring)

Hono + Drizzle/Postgres + bb.js. One process per institution; configured by env (§9).

### 6.1 DB schema (Drizzle)
```
users(id, email, privy_did, role, created_at)   -- role enum: admin|trader|approver|viewer|auditor|employee
entitlements(user_id, act_as text[], read_as text[], notional_limit_micro bigint)
parties(party_id text pk e.g. "UBS::treasury", grumpkin_priv, label)
org(singleton: name, ens_name, root_x25519_priv, biscuit_root_priv, funding_eoa_priv,
    enabled_modules text[])   -- module keys: payments|repo|payroll|issuance|strategies|lending|fx|compliance|reports
notes(cid pk, template_id, payload jsonb, salt, note_secret, stakeholders text[],
      status enum[active,pending_consume,consumed], owner_party, encumbrance_cid?,
      created_tx, consumed_tx?, block_num)
workflows(id, kind enum[transfer,payroll,repo], state jsonb, status, created_by)
approvals(id, workflow_id, requested_by, amount, status, approver?, reason?, ts)
audit_log(id, ts, actor, action, detail jsonb)   -- append-only
employees(id, user_id?, subname_label, claim_hash, x25519_pub?)  -- for payroll + CCIP gateway
ens_whitelist(ens_name pk, resolved_encpubkey, resolved_endpoint, resolved_at, status)
sync_cursor(singleton: last_block)
```
Disposable-cache invariant: everything in `notes` must be rebuildable from chain events + org keys. `ring resync --from-zero` (CLI) drops `notes`+`sync_cursor` and replays — **build this; it's cheap and it's a demo line.**

### 6.2 API (REST, `/v1`, Biscuit bearer auth; full request/response in packages/sdk types)

**Invariant: API-first.** The dashboard is a pure client of this API — every dashboard action maps to an endpoint below, no dashboard-privileged paths exist, and any flow demonstrable in the UI must be executable via the sdk/curl with a suitably scoped Biscuit (human session or service token — same policy engine, same four-eyes, same audit log). This is the institutional integration surface (the Ledger-API heritage); a CI test drives the full repo cycle through the sdk alone.
```
POST /auth/exchange            {privyToken} → {biscuit}          # Privy JWT → session Biscuit (1h, user facts)
GET  /me                        → {user, role, capabilities, enabledModules}
GET  /settings/modules         admin  → all modules w/ status (live|partial|roadmap) + enabled flags
PUT  /settings/modules         admin  {module, enabled}   # roadmap modules can be toggled — reveals preview page
POST /users/invite             admin  {email, role, actAs[], limit}
GET  /users                    admin
PUT  /users/:id                admin  {role?, actAs?, limit?}
GET  /whitelist                        → ens_whitelist rows
POST /whitelist                admin  {ensName} → resolves via Sepolia, stores, status
POST /service-tokens           admin  {actAs[], templates[], maxNotional, ttl} → {biscuit}
GET  /portfolio                        → balances per party + positions (+strategy value via fork read)
GET  /contracts?template=&party=       → ACS
GET  /contracts/:cid                   → note + history
POST /transfers                trader {fromParty, toPartyOrEns, amountMicro}   # internal or X1
POST /payroll/run              trader/admin {payments:[{employeeId, amountMicro}]}
POST /payroll/claim-data       employee → {entitlementCid, claimSecret, merklePath, root}  # browser proving inputs
POST /payroll/submit-claim     employee {proof, publicInputs} → relayed settle  # verifies + relays
GET  /repos                            → workflows kind=repo
POST /repos                    trader {counterpartyEns, collateralCid, cashAmountMicro, rateBps, days}
POST /repos/:id/accept         trader (lender side)
POST /repos/:id/close          (also fired by maturity cron)
GET  /approvals                approver
POST /approvals/:id/decide     approver {approve, reason?}
POST /strategies/earn/deposit  trader/admin {amountMicro}   # funding wallet → Privy Earn (real chain)
POST /strategies/earn/withdraw trader/admin {amountMicro}
GET  /strategies               → Privy Earn balance/APY + greyed private-strategy card data
GET  /audit/export             auditor → JSON package {notes decrypted, commitments, txids}
GET  /events  (SSE)            → events: note_created, note_consumed, approval_pending,
                                 approval_decided, workflow_updated{kind,id,state},
                                 settlement_status{txid, status: inflight|committed|final}
GET  /public-feed (SSE, unauthenticated)  → raw Settled events for the split panel
```
Authorization: every mutating route checks Biscuit facts (role, act_as, notional limit). Over-limit mutations create `approvals` row + SSE instead of executing; on approve, execute.

### 6.3 Internal engines
- **Note manager**: coin selection (largest-first) over `notes status=active template=Cash owner=party`; marks inputs `pending_consume` (released on failure); builds witness; change note to self. Contention: on nullifier-already-used revert → re-select once, then surface `CONTENTION` error Canton-style.
- **Prover**: in-process queue (p-queue, concurrency 1); witness via `noir_js` execute, then **ProveKit Groth16 proving** (CLI subprocess or bindings); ~seconds per proof, status surfaced via workflow SSE. (Fallback mode: bb.js prove, same queue.)
- **Sync engine**: viem watcher on `Settled` events → for each ciphertext: viewTag check → decrypt → upsert note (created), mark consumed by nullifier match (node stores expected nullifiers for its notes: N computable since it knows note_secret). Confirmation depth: status `committed` at 1 block, `final` at +2 blocks on fork (narrate real finality).
- **Maturity cron**: every 10s scan active RepoAgreements where `maturity_ts <= chain.timestamp` and we are dealer → fire close.
- **Repo workflow state machine**: `draft → pending_approval? → allocated(on-chain) → proposed(visible to lender via chain) → accepted/settled → matured → closed`. Lender discovers proposals via sync engine (proposal note has lender as stakeholder) — **no off-chain relay needed; propose-accept is fully on-chain.**

### 6.4 Coordinator (apps/coordinator) — deliberately tiny
- **Relayer**: `POST /relay {to, calldata}` → signs with relayer EOA, submits to fork, returns txid. Per-org token, rate limit.
- **Provisioning** (demo only): script-level, not service: `scripts/provision-ring.sh <org>` creates DB, keys, env, registers ENS subname.
- (Directory = ENS. Message relay = none, proposals travel on-chain.)

### 6.5 CCIP-Read gateway (apps/gateway or route in ring)
ERC-3668 + ENSIP-10 per ensdomains/offchain-resolver reference: deploy `OffchainResolver` on **Sepolia** for `ubs.aragorn.eth` with gateway URL + signer pubkey; gateway endpoint serves signed responses for `<label>.ubs.aragorn.eth` text/addr queries from `employees` table. Demo shows `cat.ubs.aragorn.eth` resolving in the dashboard (and at the ENS booth via any standard resolver lib).

### 6.6 ENS setup (Sepolia, one-time script `scripts/ens-setup.ts`)
Register `aragorn.eth` (or available variant) on Sepolia; create subnames `ubs`, `drw`; set text records: `aragorn.encpubkey`, `aragorn.endpoint`, `aragorn.partyroot`; set ubs subname resolver → OffchainResolver for employee wildcard. Whitelist flow reads these via viem ENS APIs against Sepolia RPC.

---

## 7. Dashboard (apps/dashboard)

Next.js App Router + shadcn + Tailwind + Privy React. Capability-driven rendering from `/me`. Use the design prompt in the conversation/PLAN §6: graphite + gold, ring motifs (Borromean logo, progress rings, half-ring approvals, lock-band encumbrance, gray-ring public feed), desk vocabulary with dotted-underline hover glossary, **no hex anywhere** (names only).

**Module model (PLAN §6)**: nav and pages = enabled modules (org.enabled_modules) ∩ role capabilities, driven by `/me`. Core (always): Onboarding, Portfolio, Inbox, Admin (incl. **Settings → Features** module toggles), Audit, public-view split panel (right-third drawer fed by `/public-feed` SSE, gray rings + proof badge, correlated to private events by txid when entitled).

Modules: **Payments** (live), **Repo** (live: blotter; greyed margin/substitution/default), **Payroll** (live: employees + subnames, run w/ four-eyes, claim statuses; employee role sees only **My Pay** with in-browser claim proving), **Issuance** (Registry of seeded bond viewable; Issue/DvP/coupon buttons greyed), **Strategies** (Privy Earn live; private-strategies card greyed), **Lending/FX/Compliance/Reports** (roadmap: toggleable in Settings, render preview pages — one-paragraph intent + greyed components). In-page greys in Admin: FROST quorum config, HSM, Safe link, key rotation, plus a greyed **"Build on Aragorn"** card in Settings (template SDK — developer composability roadmap, PLAN §6; infrastructure posture: we ship protocol/node/SDK, the dashboard is the reference client, no third-party code hosting). One shared `<RoadmapBox>` component for every greyed element ("Roadmap" badge + tooltip).

Browser proving (payroll claim): employee page fetches `/payroll/claim-data`, runs ProveKit (or bb.js WASM fallback) in a web worker with a "generating proof locally — your salary never leaves this device" ring animation, posts proof to `/payroll/submit-claim`.

---

## 8. Phase gates (each is a runnable command; do not advance on red)

| Phase | Gate command | Green means |
|---|---|---|
| P0 | `make p0` | ProveKit pipeline proves+verifies a trivial circuit on Anvil via Groth16 (browser AND server proving demonstrated) — or fallback-to-bb verdict recorded; Poseidon2 byte-equality TS↔Noir↔Solidity fixture passes; Privy Earn spike verdict + Schnorr-in-R1CS verdict written to DECISIONS.md |
| P1 | `make p1` | cash_shield/transfer/unshield circuits + NoteRegistry + ShieldVault: scripted shield→transfer→unshield round-trip on fork via packages/protocol only |
| P2 | `make p2` | two ring processes + relayer: X1 payment UBS→DRW via API (curl), sync engines converge, `ring resync --from-zero` rebuilds |
| P3 | `make p3` | Privy login → Biscuit exchange; invite/roles; whitelist resolves drw.aragorn.eth from Sepolia; CCIP gateway resolves cat.ubs.aragorn.eth; dashboard shell shows portfolio from seeded state; I3 four-eyes transfer end-to-end in UI |
| P4 | `make p4` | X4 full repo cycle in UI across two windows incl. time-warp auto-close; I6 payroll run + claim (server-proved acceptable here) |
| P5 | `make p5` | B2 Privy Earn deposit/withdraw + balance/APY in UI (real chain); browser proving for claim working |
| P6 | `make demo` | `demo-reset` → full §2 PLAN script executes clean; all roadmap pages render; backup video recorded |

`make demo-reset`: anvil snapshot revert (or restart fork + redeploy + reseed), DB truncate + resync, seeds per §10.

---

## 9. Environment (`.env.example` per app)

```
# shared
FORK_RPC_URL=http://anvil:8545
SEPOLIA_RPC_URL=            # for ENS reads + gateway resolver
FORK_BLOCK=                 # pinned, see DECISIONS.md
NOTE_REGISTRY_ADDR=  SHIELD_VAULT_ADDR=
USDC_ADDR=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

# per ring (UBS example)
RING_ORG_NAME=UBS  RING_ENS=ubs.aragorn.eth  DATABASE_URL=
PRIVY_APP_ID=  PRIVY_APP_SECRET=
EMAIL_DOMAIN_ALLOWLIST=ubs-demo.com          # use demo domains; Privy test emails
RELAYER_URL=  RELAYER_TOKEN=
FUNDING_EOA_PRIVATE_KEY=                      # seeded; Privy server wallet optional upgrade
GATEWAY_SIGNER_KEY=                           # CCIP response signing

# coordinator
RELAYER_PRIVATE_KEY=

# privy earn (real chain)
EARN_CHAIN=base  EARN_WALLET_ID=              # per Earn spike findings
```
Demo identities: use `@ubs-demo.com` / `@drw-demo.com` style domains (we can't receive mail at ubs.com); Privy test-email mode for live demo reliability.

---

## 10. Seed script (`scripts/seed.ts`)

1. Impersonate USDC whale on fork → fund both funding EOAs ($20M each) + relayer ETH.
2. Approve ShieldVault; shield $10M for UBS (treasury party), $10M for DRW.
3. **Seed the Goldman bond**: directly insert a BondPosition note (owner=UBS::trading, issuer label "Goldman Sachs", `isin_hash("US38141G1040-DEMO")`, face $5M) via a privileged `seed_note` path: deploy-time-only contract function `seedCommitments(bytes32[])` (owner-gated, used once, narrated honestly if asked).
4. Privy Earn: deposit a small real amount from each funding wallet so the Earn card shows a live balance/APY (real chain, see §9).
5. Payroll history: run one payroll (3 employees), claim one entitlement.
6. Internal transfer history: one completed I3 with approval trail.
7. Users: UBS {admin, jane=trader($1M limit), marcus=approver, auditor}; DRW {admin, trader}.
8. ENS + CCIP records (Sepolia, idempotent skip if set).
9. Enabled modules: UBS {payments, repo, payroll, issuance, strategies}; DRW {payments, repo, strategies}.

---

## 11. Testing & CI

- `circuits`: nargo test per crate (witness-level happy + violation cases: bad conservation, wrong auth, replayed nullifier is contract-level).
- `contracts`: forge test incl. proof fixtures.
- `packages/protocol`: vitest — commitment/nullifier/envelope fixtures shared with Noir test vectors (one JSON fixture file consumed by both).
- e2e: `make p2`/`make p4` style scripted flows via sdk against docker-compose.
- CI (GitHub Actions): pnpm build + the above + verifier regen diff.

## 12. Agent execution notes

- Work the phase gates in order; never start a dependent layer on a red gate.
- Every resolve-at-build item gets a DECISIONS.md entry (what was found, what was chosen, link).
- When an external API contradicts this spec (ProveKit, Privy Earn, bb.js), the spec's *fallback* applies before any redesign; redesigns get a DECISIONS.md entry.
- packages/protocol is the only place protocol constants live; if a circuit needs a change, change protocol first, regenerate fixtures, then conform.
- Commit per gate minimum; keep `make demo` green from P4 onward.
- UI polish pass (frontend-design quality bar per PLAN §6) happens at P6, not before.
```
