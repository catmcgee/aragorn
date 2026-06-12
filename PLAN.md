# Aragorn — PoC Plan ("Canton on Mainnet")

*Proof-of-concept + demo plan. Companion to `EXPLORATION.md` (the design rationale). This document is the build spec.*

---

## 0. Naming — DECIDED

**Project: Aragorn. Instance: Ring** (each institution spins up a Ring — their sovereign private ledger node, Canton's "participant node", our §2.6 product).

The fit is better than it looks: each holder keeps their Ring private and sovereign; the public chain sees that the Rings exist but never what they hold. Usable demo line: *"keep it secret, keep it safe."*

One caution for a public submission: the Tolkien Estate / Middle-earth Enterprises actively enforces trademarks (they took down "JRR Token" via WIPO). Fine for a hackathon weekend; revisit before anything commercial ships under this name.

(Rejected along the way: Enclave — TEE/SGX connotation, misleading for a trustless-crypto system; Atrium/Suite, Curb/Seat, Bailey/Keep, Finality/Books — see git history for the full derby.)

---

## 1. What the demo must prove (acceptance criteria)

*(Full-PoC scope intent. The buildable demo target — what actually ships this weekend — is BUILD_SPEC §0; items 4–5's three-institution framing collapses to the two-Ring cast of §2.)*

A viewer watches, end to end, in ~10 minutes:

1. **Onboard**: An institution spins up a fresh Ring (one command / one click), the founding admin signs in with their institutional email (Privy), names the institution, and the Ring generates its root key + party structure on Ethereum-side keys automatically.
2. **Team & control**: Admin invites colleagues by email (domain-restricted), assigns roles (admin / trader / approver / viewer / auditor), sets counterparty whitelist and per-user limits. A trader's risky action visibly requires an approver (four-eyes).
3. **Internal workflow** (within one institution): treasury → trading **department** cash transfer with approval flow, plus a payroll run with employees claiming privately; settles as real on-chain note movements; outsiders see nothing meaningful.
4. **Bond issuance** (institution A = issuer/registrar): A issues a digital bond; institution B buys via atomic DvP; A (registrar) sees the holder ledger, B sees only its own position; coupon day pays via fan-out entitlements.
5. **Repo** (between institutions): B repos the bond to C for USDC cash — proposal w/ collateral allocation → accept (atomic DvP) → time-warp → automated close (cash + interest vs collateral back). Show the default path optionally.
6. **DeFi yield** (the pitch: tradfi + crypto-native): the institution's public treasury buffer earns via **Privy Earn — which allocates to Morpho under the hood** — live balance/APY in the dashboard, deposit/withdraw working. Beside it, the **private strategies card is greyed roadmap**: shielded cash into the same venues with the position itself a private note (design exists — EXPLORATION + circuits reserved — cut from PoC since Earn already delivers the Morpho yield story).
7. **The money shot — split-screen "What the world sees"**: every step above, a side panel shows the public Ethereum view (opaque commitments, nullifiers, a verified proof, relayer-paid gas) next to the institution's rich private view. Plus an **auditor view**: scoped viewing-key export showing a regulator's read-only window.

Throughout: nobody on screen touches a wallet, gas, a note, or a nullifier (§2.6 of EXPLORATION.md), yet every movement is a real Ethereum transaction (§6.4).

---

## 2. Demo narrative (the script the build serves)

Cast — real Canton-ecosystem institutions, used illustratively: **UBS** (dealer — publicly executed intraday repos on Broadridge's DLR) and **DRW** (lender — Canton Network pilot participant), two browser windows, one terminal, one narrator. (**Goldman Sachs** exists only as the seeded bond's issuer name — GS DAP is literally their digital bond issuance platform.) Label the demo "illustrative scenario" — real names, fictional trades.

**Format decision: ONE flow runs live — the repo.** Everything else is shown visually from pre-seeded state. The repo is chosen because it organically exhibits the most machinery: internal policy (four-eyes folded into the booking), ENS-named counterparties, inter-Ring proposals, atomic DvP, encumbrance, in-circuit interest, time-gating, and the public-view panel.

**Pre-seeded state**: both Rings onboarded with teams/roles; UBS holds the bond position + shielded USDC; DRW holds shielded USDC; a live Privy Earn balance on the funding wallet; payroll claim history; auditor configured.

**Act 1 — Visual tour (~3 min), UBS's window:**
- Top bar: gold ring mark + `ubs.aragorn.eth`, role chip. *"This institution is a name, not an address — there's no hex anywhere in this product."*
- **Portfolio**: positions by department, drill into the bond's history, settlement-status rings. *"Everything here lives encrypted on Ethereum; this database is a disposable cache of it."*
- **Admin**: users with roles/entitlements (invited by work email via Privy), limits, counterparty whitelist showing `drw.aragorn.eth` resolving live, the scoped-Biscuit "connect your OMS" card.
- **Strategies**: Privy Earn card live (real balance/APY — Earn allocates to Morpho) beside the **greyed private-strategies card**. *"The treasury buffer earns through Morpho today; on the roadmap, shielded cash runs the same strategies with the position itself private."*
- Flash the **payroll history** (a salary claimed via in-browser proof) and the **auditor view** (decrypted history pinned to L1 commitments).

**Act 2 — Live repo (~5 min), split-screen public view ON:**
1. Trader books $5M overnight vs the bond at 5.30% with `drw.aragorn.eth` — **deliberately over their limit**: two half-rings appear; the approver signs; the circle closes. *"Internal controls are node-side policy; the chain never knows users exist."*
2. Collateral allocates (lock band appears on the bond ring); the proposal lands in **DRW's inbox** (second window) with full terms. *"The rate is visible to these two institutions and nobody else on earth."*
3. DRW accepts → **one atomic settle**: cash and collateral swap, the agreement is born encumbered. Point at the public panel: *"that entire DvP was this — gray rings and a verified proof."*
4. Terminal: time-warp one day. Auto-close fires: principal + interest (computed inside the proof — a wrong number cannot verify) to DRW, collateral unlocked to UBS. Both portfolios update.
5. Full-screen the public view: the day's entire activity as a column of identical gray rings. *"Keep it secret, keep it safe."*

**Booth strategy (separate from the stage script):** flows not run live on stage must still be *functional* for sponsor judging — ENS booth gets live resolution + CCIP subname lookup, World booth gets the in-browser ProveKit salary claim, Privy booth gets onboarding + Earn. The stage constraint changes what's *executed* in 10 minutes, not what's *built*.

### 2.1 Flow inventory (the demo's test checklist)

**Internal (one Ring):**
| # | Flow | Chain? | Proves |
|---|------|--------|--------|
| I1 | Ring setup: Privy onboard, invite team, roles/entitlements, limits | no | "spin up a thing, add people" |
| I2 | Shield: funding EOA USDC → private Cash notes | yes | the asset boundary |
| I3 | Department-to-department transfer (treasury → trading) w/ four-eyes approval | yes | internal workflows are real settlements; policy engine |
| I4 | Whitelist counterparty by ENS name | no (Sepolia read) | identity layer; ENS prize moment |
| I5 | Auditor viewing-key browse + export | no | compliance story |
| I6 | **Payroll run**: treasury fan-out → employees claim to `cat.ubs.aragorn.eth` (browser ProveKit) | yes | sub-Ring privacy (colleagues can't see each other's pay); reuses coupon circuits; CCIP-Read employee subnames |

**Inter-Ring (institution ↔ institution):**
| # | Flow | Chain? | Proves |
|---|------|--------|--------|
| X1 | Private USDC payment Ring→Ring | yes | simplest bilateral settlement (P1 checkpoint) |
| X2 | Bond issuance DvP (propose-accept) | yes | per-template privacy: registrar ledger vs holder privacy *(weekend cut: seeded)* |
| X3 | Coupon fan-out → holder claims (reuses I6's payroll circuits) | yes | fan-out pattern across institutions *(weekend cut: skip; payroll carries the circuits)* |
| X4 | **Repo lifecycle**: propose+allocate → atomic accept → auto-close w/ in-circuit interest (optional: default) | yes | authority-from-contract, encumbrance, time gating — **the centerpiece** |

**Boundary (Ring ↔ public chain):**
| # | Flow | Chain? | Proves |
|---|------|--------|--------|
| B1 | Private DeFi strategies (position = private note) | — | **greyed roadmap card** — cut: Privy Earn already delivers the Morpho yield story; design retained in EXPLORATION |
| B2 | Privy Earn on public treasury buffer | yes (real chain) | two privacy modes, same yield; Privy prize moment |
| B3 | Unshield to funding EOA | yes | exit ramp |

Stage mapping (§2): **live = X4** (with I3's four-eyes folded into the booking); **toured from seeded state** = I1, I4, I5, I6 (history), B1, B2; **seeded silently** = I2, X1, X2; **booth-only** = I6 live (World), I4 live (ENS), onboarding + Earn (Privy); X3 cut.

---

## 3. Architecture (PoC cut of the EXPLORATION.md design)

```
┌─ Frontend (Next.js dashboard, one app, institution-scoped via Privy) ─┐
│  portfolio · workflows/inbox · blotter · bond registry ·         │
│  strategies (Privy Earn) · admin (users/roles/whitelist) · audit ·        │
│  public-view split panel                                              │
└───────────────────────────┬───────────────────────────────────────────┘
                            │ REST + SSE (per-Ring API, Privy JWT)
┌───────────────────────────┴───────────────────────────────────────────┐
│  Ring node (TypeScript service; one instance per institution)      │
│  • Ledger API-lite: create / exercise / query ACS / stream            │
│  • Note manager: coin selection, change, encumbrance tracking         │
│  • Prover: Noir/bb.js, server-side (institution's own infra, §4.2)    │
│  • Wallet: root key + party keys (software keys for PoC; HSM later)   │
│  • Identity: Privy JWT verification → users → entitlements → parties  │
│  • Policy engine: roles, four-eyes, limits, counterparty whitelist    │
│  • Sync engine: watch L1 events, decrypt tagged payloads, projection  │
│  • Postgres: projection store (contracts), users, policies, audit log │
└──────────┬──────────────────────────────┬─────────────────────────────┘
           │                              │
┌──────────┴───────────┐   ┌──────────────┴──────────────────────────────┐
│ Coordinator service  │   │ Chain (Anvil mainnet fork; Sepolia stretch) │
│ (shared, minimal):   │   │ • Base contract: note tree + root history + │
│ • tx relayer (gas)   │   │   nullifier set + per-circuit verifiers     │
│ • provisioning       │   │   (PoC scaffolding; kernel later)           │
│ (directory = ENS;    │   │ • settle() with ciphertexts in calldata/    │
│  proposals travel    │   │   events (blobs later)                      │
│  on-chain)           │   │ • Shield boundary: USDC in/out              │
└──────────────────────┘   └─────────────────────────────────────────────┘
```

**Explicit PoC simplifications** (each is testnet scaffolding per EXPLORATION.md §8 — name them honestly in the demo):
- Per-circuit **Groth16 verifiers (ProveKit pipeline, dev-mode trusted setup)**, no kernel recursion, no shape padding → anonymity-set unification is *narrated*, not implemented. (bb/Honk is the specified fallback prover.)
- Ciphertext payloads in calldata/events, not EIP-4844 blobs.
- One shared relayer paying gas (no 4337, no timing decorrelation).
- Software keys, no HSM; coordinator is a trusted convenience (it sees encrypted blobs + metadata only — never cleartext, never keys).
- Anvil mainnet fork as the chain (real USDC, instant blocks, `evm_increaseTime` for maturities). Yield runs on a real chain via Privy Earn (which allocates to Morpho) — no fork-DeFi dependency. Stretch: full Sepolia deployment.

---

## 4. The cryptographic core (PoC scope)

### 4.1 Primitives
- **Curve/hash**: Poseidon2 commitments & nullifiers; party signatures = Schnorr over Grumpkin (circuit-cheap; keys held by Ring node). ECDSA/HSM compat is out of scope.
- **Commitment**: `C = Poseidon2(template_id, version, payload_hash, stakeholders_hash, salt)`.
- **Nullifier**: `N = Poseidon2(C, note_secret)`; `note_secret` ships in the encrypted payload to all stakeholders (required for authority-from-contract spends — EXPLORATION.md §2.1).
- **Note tree**: incremental Poseidon Merkle tree (depth 32) in the base contract; **root history ring buffer** (e.g. last 64 roots).
- **Payload encryption**: ECIES on X25519 (per-stakeholder), 32-byte view tags for cheap discovery scanning.
- **Time**: claimed-time-bound public input, contract checks against `block.timestamp` (EXPLORATION.md §6.3 fix).

### 4.2 Circuits (Noir; one per template-choice; keep each < ~50k constraints for fast server proving)

| # | Circuit | Proves |
|---|---------|--------|
| 1 | `cash_shield` | USDC deposited at boundary → Cash note minted (public amount in, private owner) |
| 2 | `cash_transfer` | n-in/2-out Cash notes, owner signature, conservation of value |
| 3 | `cash_unshield` | Cash notes burned → public USDC release to target address |
| 4 | `bond_issue` | Issuer signature → BondTerms note + BondPosition notes |
| 5 | `bond_dvp_accept` | Subscription accept: cash ↔ position atomically (allocation pattern) |
| 6 | `cash_fanout` | Funded batch → per-recipient entitlement notes. **Shared by bond coupons AND payroll** (same shape: one pool, N private recipients, zero contention) |
| 7 | `entitlement_claim` | Recipient consumes entitlement → Cash note. The ProveKit browser-proving target (coupon or salary claim) |
| 8 | `repo_propose_allocate` | RepoProposal + CollateralAllocation (locks BondPosition) + Withdraw escape |
| 9 | `repo_accept` | Atomic on-leg: proposal+allocation+cash → encumbered position + cash + RepoAgreement |
| 10 | `repo_close` | Off-leg: agreement + cash(P+interest, computed in-circuit) + encumbered position → unwound; time-gated |
| 11 | `repo_default` | Time-gated seizure: encumbered → lender-owned + DefaultNotice |
| ~~12~~ | ~~`strategy_deposit`~~ | **Cut → roadmap** (private strategies; template_id 7 reserved) |
| ~~13~~ | ~~`strategy_withdraw`~~ | **Cut → roadmap** |

Shared Noir library: note read/write gadgets, Merkle membership, signature check, stakeholder hashing, conservation helpers. **This library is the seed of the template abstraction** (EXPLORATION.md §2.2) — write it as if it will become the public framework.

### 4.3 Contracts (Solidity, Foundry)
- `NoteRegistry.sol` — tree, root history, nullifiers, `settle(templateId, proof, publicInputs, ciphertexts[])`, events. Per-template verifier registry (generated Honk verifiers).
- `ShieldVault.sol` — USDC custody for shield/unshield; called only by NoteRegistry on valid proofs.
- ~~MorphoAdapter.sol~~ — **cut → roadmap** (private strategies). Yield = Privy Earn on the funding wallet.

(No oracle contract in the PoC — review finding: nothing in the demo needs one. Repo interest is computed in-circuit from the agreed terms; margin calls are out of scope; Earn APY/balance comes from the Privy API. Oracle attestations return with the margin/NAV lifecycle in production scope.)

---

## 5. The Ring node (TypeScript)

### 5.1 Identity & control plane (the "spin up a thing and add people" story)
- **Provisioning**: `POST /rings` on the coordinator (or CLI `ring init`) → allocates node instance (Docker), generates root key + default **departments** (`Org::treasury`, `Org::trading`, `Org::ops` — each department is a party, i.e. a sub-ledger that owns notes; distinct from user *roles*, which govern what people may do), registers org in directory with its encryption pubkeys.
- **Public funding EOA**: each Ring also manages one ordinary Ethereum account — the address that holds *unshielded* USDC, approves the ShieldVault for deposits, and receives unshield proceeds. Seeded by the demo script (whale impersonation on the fork); in production this is the institution's existing custody wallet. (Review finding: the shield boundary needs a public-side wallet somewhere; it was implicit before.)
- **There is no wallet login, by design.** Humans never hold chain keys: individual wallets would mean individual custody — phishable seed phrases, unrecoverable key loss, no four-eyes, assets walking out the door with an employee. All signing keys (root, departments) are generated and held by the Ring (software for PoC, HSM/KMS in production); humans get *authorization* (roles → entitlements → Biscuits), never *keys*. This is also exactly Canton's model: participant nodes hold party keys (typically in AWS/GCP KMS or HSMs), namespace root keys delegate to them via topology transactions, and humans authenticate to the Ledger API with enterprise OAuth/JWT — no end-user wallets exist anywhere in Canton. Our onboarding is Canton-parity with better UX: Privy email/SSO in front, Ring-held keys behind.
- **Auth (humans)**: Privy (email + institutional SSO). Ring verifies Privy JWTs server-side. First user = founding admin. Invites restricted by **email domain allowlist** (e.g. `@ubs.com`); Privy makes "institutional email is enough" literal.
- **Auth (API / services / sessions): Biscuit tokens, not API keys.** Programmatic access to the Ring API (OMS integrations, the SDK, automation, e2e tests) uses [Biscuits](https://biscuitsec.org): public-key-verified bearer tokens with **offline attenuation** and embedded Datalog policy. The fit is exact — a Biscuit *is* an entitlement made portable: the admin mints a token scoped `actAs: Org::trading, templates: [Cash], maxNotional: 1M, expiry: …`, and any holder can further attenuate it (e.g. hand the OMS a copy restricted to read-only) **without contacting the Ring**, while the Ring verifies offline against the org's public key. Human Privy sessions are exchanged at login for a short-lived Biscuit carrying that user's entitlements, so the policy engine has ONE enforcement path for humans and machines. No shared-secret API keys anywhere. (JS support via `biscuit-wasm`; P0 spike alongside the other integration spikes.)
- **RBAC**: roles = `admin`, `trader`, `approver`, `viewer`, `auditor`. Mapping: user → role → entitlements (`actAs: [Org::trading]`, `readAs: [Org::*]`), materialized as Biscuit facts. Stored node-side; chain never sees users (§2.6).
- **Policy engine**: per-user notional limits; **four-eyes**: actions above threshold create a `PendingApproval` (node-side) that an approver must confirm before the node signs with the party key; **counterparty whitelist**: outbound proposals & inbound proposal acceptance filtered by org allowlist; all decisions written to an append-only audit log.
- **Signing strategy (PoC vs production).** PoC policy is enforced in Ring software (above). Production upgrades the same rules into cryptography, *not* a Safe — a Safe is an on-chain contract wallet, so it can't sign inside circuits and would publish the signer set, thresholds, and approval timing we exist to hide. Instead: **(a) FROST threshold Schnorr party keys** — a department key is M-of-N with shares on approvers' devices/HSMs; circuits verify one Schnorr signature and never know a quorum produced it (zero circuit changes, zero on-chain footprint, signer set invisible even to counterparties; a fully compromised Ring still can't move assets alone); **(b) in-circuit policy predicates** — a committed policy in the party record, e.g. *(amount < $1M AND desk key) OR treasury quorum; non-whitelisted counterparty ⇒ quorum regardless* — Safe-style configurable rules, enforced by math, private from the world, rotatable by root. An actual **Safe multisig is right for the public funding EOA** in production (it's on the public plane anyway; auditors like it). Demo narration: "policy in software today, policy in cryptography in production — same rules you'd set on a Safe, invisible."
- **Audit**: auditor role gets derived read-only viewing key; "Export audit package" = decrypted history + commitment openings, verifiable against L1.

### 5.2 Ledger plane
- **Ledger API-lite (REST + SSE)**: `POST /contracts` (create), `POST /contracts/:id/exercise`, `GET /acs?template=`, `GET /events` (SSE stream), `GET /balances`, plus typed convenience endpoints per workflow (`/repos`, `/bonds`, `/strategies`, `/transfers`).
- **Note manager**: coin selection over Cash notes, change outputs, encumbrance state machine (unencumbered ⇄ allocated ⇄ encumbered), contention retry ("contract archived by concurrent transaction" surfaced Canton-style).
- **Prover**: bb.js / nargo execution server-side; proof queue with status; target < 10s per proof on a laptop.
- **Sync engine**: L1 event tail → view-tag scan → decrypt → upsert projection (contracts table with template, payload JSON, status, tx hash); reorg-tolerant on the fork (trivial), reorg notes for production.
- **The Postgres is a disposable cache, not state of record.** Design invariant: every durable fact lives on Ethereum as ciphertext; the projection store is derived from L1 + the org's keys and can be deleted and fully rebuilt by resync. The Ring holds *keys*, not *state*. (Demo-able: `ring resync --from-zero` wipes the DB and restores everything — a stronger continuity story than Canton, where losing the participant DB is catastrophic.)
- **Inter-Ring transport**: none needed — propose-accept travels **on-chain** (the proposal note's encrypted payload names the counterparty as stakeholder; their sync engine surfaces it in the inbox). One less service, and proposals are already settlement-grade.

### 5.3 Coordinator (shared service, deliberately thin)
- Relayer: receives signed settle payloads, pays gas, submits; per-org rate limits
- Provisioning API for new Rings
- (Directory = ENS; inter-Ring messages travel on-chain — no relay service exists)

---

## 6. Frontend (Next.js, single dashboard app)

Stack: Next.js App Router on Vercel-compatible setup, shadcn/ui + Tailwind, Privy React SDK, SSE for live updates. Design bar: "Bloomberg terminal calm, not crypto dashboard loud" — institutional, dense, beautiful (use the frontend-design skill at build time).

**The UI is capability-driven**: the API returns the session Biscuit's capabilities; the frontend renders only what the token permits. No client-side role logic — one enforcement path (§5.1).

**The module model — one mental model for the whole dashboard.** A Ring = **core + modules**. Core is always on: Portfolio, Inbox, Admin (incl. Settings), Audit, and the public-view panel. Everything else is a **module** — a business capability the admin enables in **Settings → Features**. Each enabled module contributes its nav item, its portfolio sections, and its API scopes. What any user sees = *enabled modules ∩ their role's capabilities* (Biscuit). That's the entire rule; there are no special cases.

| Module | Status in PoC | Contents |
|---|---|---|
| **Payments** | ✅ live | internal department transfers, Ring→Ring payments, payroll isn't here — see Payroll |
| **Repo** | ✅ live | blotter, book/accept/close; greyed in-page: margin call, substitution, default |
| **Payroll** | ✅ live | employees + subnames, run w/ four-eyes, claim statuses; employee role gets My Pay; greyed: scheduled runs |
| **Issuance** | 🔶 UI live, flows greyed | the Registry: terms + holder ledger of the seeded Goldman bond viewable (registrar view); **Issue / DvP / coupon-run buttons greyed "Roadmap"**. Exists because issuance is core to the product even though the demo seeds the bond |
| **Strategies** | ✅ live (Earn) | Privy Earn deposit/withdraw + live APY; greyed: private strategies card, Aave/Uniswap |
| **Lending** | ░ roadmap | open-term securities lending — loan blotter, recall queue, rerate panel (all greyed preview) |
| **FX** | ░ roadmap | intraday FX swaps, PvP atomic both legs — swap ticket, pairs board (greyed preview) |
| **Compliance** | ░ roadmap | screening status, association sets (Privacy Pools), viewing-key grants, disclosure queue (greyed preview). Carries **the KYC position** copy: KYC isn't the platform's job — making KYC status *provable without disclosure* is: bilateral KYB at whitelisting (vLEI verification in production), issuer eligibility credentials enforced in-circuit for regulated assets, employees delegated to the employer via domain-locked Privy, AML via chain analytics + association sets at the shield. Platform custodies nothing — software-vendor posture, same as Canton |
| **Reports** | ░ roadmap | report builder, scheduled exports, reconciliation certificates pinned to L1 (greyed preview) |

Roadmap modules appear in Settings → Features as toggles with a "Roadmap" badge; toggling one reveals its **preview page** — one paragraph of what it *will* do (in desk language) + its intended components as greyed disabled boxes. Never a dead click, never ambiguity about what works. In-page greys on live modules (FROST quorum config, HSM settings, Safe link, key rotation in Admin; netting on blotter; custody sub-accounts on portfolio) follow the same rule: visible, disabled, badged.

**Settings → Features is itself a demo beat** (Act 1, Admin): *"institutions compose their Ring from the businesses they run — UBS turned on Repo, Payroll, Issuance, and Strategies; Lending and FX are on our roadmap."* Working flows are exactly the §2.1 list; everything else on screen is honestly grey.

**Developer composability — infrastructure posture (we ship protocol + node + SDK; we never host, vet, or sandbox third-party code):**
- **What Aragorn is**: (1) the protocol — settlement contract, note format, and the *template standard*; (2) the Ring node; (3) the SDK. **The dashboard is the reference client**, not a platform (Uniswap Labs frontend vs Uniswap protocol). The module model = feature flags of *our* client, nothing more.
- **Template authors** (the real composability): publish template packages (Noir circuits + payload schema + workflow) as protocol artifacts — like ERCs/contracts on Ethereum. Permissionless because the math makes it safe, not because anyone vetted it: `template_id` is hashed into every commitment so no template can forge or spend another's notes; authority-from-contract is opt-in by a note's own stakeholders; a malicious circuit endangers only assets voluntarily placed under it and can inflate only its own asset type. Settlement invariants are unbreakable from above. And every new template feeds the same anonymity set: **more apps = more privacy for everyone**.
- **App builders**: their own frontends/services/OMS bridges on their own infrastructure, talking to Rings via Biscuit-scoped APIs — under the institution's policy engine, in its audit log, never holding keys. Worst case = abuse within explicitly granted scope.
- If someone wants an extensible app-store dashboard with third-party UI plugins, that's a *product someone builds on this infrastructure* — their sandbox, their registry, their liability.
Judge soundbite: *on Canton, app developers must become infrastructure (Broadridge runs a super-validator; every app is a silo). Here the infrastructure is finished and developers ship templates and apps on top.* Residuals, honestly: vendors learn what they're entitled to read (a data-sharing decision); value-bearing templates need audits (a verification market, as with smart contracts today). PoC surface: greyed "Build on Aragorn" card in Settings (template SDK docs, "Roadmap").

**Vocabulary principle: speak desk, deliberately.** The UI uses real institutional language everywhere — **blotter** (not "trades"), **book** a repo (not "create"), **term sheet**, **haircut**, **day count (ACT/360)**, **allocation**, **encumbered**, **DvP**, **registrar**, **settlement finality**, **on-leg/off-leg** — because for this audience the vocabulary *is* the credibility signal: it proves the team knows the domain it's rebuilding. Affordance for non-finance viewers: unobtrusive hover-glossary on jargon terms (dotted underline → one-line definition). Judges who know the words feel at home; judges who don't get a definition in 200ms and a stronger impression for having needed it.

### 6.1 What each role sees

| Role | Sees | Can do |
|---|---|---|
| **Admin** | Everything below + Ring health (sync status, prover queue, relayer balance, funding EOA), audit log | **Invite users by email** (domain-checked), **assign/revoke roles & entitlements** (which parties each user acts-as/reads-as), set per-user notional limits & four-eyes thresholds, **manage counterparty whitelist by ENS name**, **mint/revoke service Biscuits** (scoped, attenuable — the "connect your OMS" flow), trigger audit export, configure departments (parties) |
| **Trader** | Portfolio (only parties they hold read-as for), blotter, inbox, strategies | Book repos, initiate transfers, accept/reject inbound proposals, allocate/withdraw strategies — all within entitlement scope; over-limit actions visibly route to an approver |
| **Approver** | Approval queue + read-only portfolio/blotter | Approve/reject pending actions with reason; detail view shows notional vs limit, counterparty, simulated position impact |
| **Viewer** | Read-only portfolio + blotter for entitled parties | Nothing else — exists to demo least-privilege |
| **Employee** | **My Pay** only: unclaimed entitlements + claim history | Claim salary — proof generated in-browser (ProveKit); deliberately minimal, almost consumer-grade. The World-booth view |
| **Auditor** | Decrypted historical record via derived **viewing key**: every contract, every transition, each tied to its L1 commitment/tx hash; plus the admin audit log | Export audit package (verifiable against L1); explicitly *cannot* act, see pending approvals, or mint credentials |

Every page above renders through the module model: nav = enabled modules ∩ role capabilities. (My Pay is the employee role's sole view within the Payroll module.)

### 6.2 Visual identity: Rings, interlocked

The name is the design system:

- **Logo / mark**: interlocking rings. Specifically consider **Borromean rings** — three rings linked such that cutting any one frees all three — which is *literally atomic DvP* (all legs hold or none do). That's a logo with a thesis.
- **Institutions are rings**: each org rendered as a ring; the counterparty graph is rings linking. An in-flight bilateral settlement shows two rings approaching → **interlocking on settle** → the link is the trade. A repo unwind is rings separating cleanly.
- **Status as ring geometry**: the `in-flight → committed → final` lifecycle is a progress ring closing; encumbered positions are rings with an inner lock band; consumed notes dissolve into anonymous gray rings on the public-view timeline (commitments = featureless rings — *the public sees rings, never what's inside them*).
- **Approval flows**: four-eyes renders as two half-rings completing a circle when approver signs.
- **Palette/type**: graphite/near-black ground, one metallic accent (gold ring on graphite), dense layout, tabular numerals. The ring motif carries the playfulness so the rest can stay austere.
- Demo line available throughout: *"keep it secret, keep it safe."*

---

## 7. Repo layout & stack

```
/  (pnpm + turborepo monorepo)
├─ circuits/            # Noir: lib/ (note gadgets) + per-template crates; nargo tests
├─ contracts/           # Foundry: NoteRegistry, ShieldVault, generated verifiers
├─ packages/
│  ├─ protocol/         # TS: commitments, encryption, note types, tx building (shared node/frontend)
│  └─ sdk/              # TS client for the Ring API (used by frontend + e2e tests)
├─ apps/
│  ├─ ring/          # the node service (Fastify/Hono + Postgres/Drizzle + bb.js)
│  ├─ coordinator/      # directory + relay + relayer
│  └─ dashboard/        # Next.js frontend
├─ infra/               # docker-compose: anvil fork + 3 rings + coordinator + seeds
└─ scripts/             # deploy, seed (USDC whale impersonation), demo-reset, time-warp
```

Key deps: Noir/nargo + Barretenberg (pin versions), Foundry, viem, Privy, `biscuit-wasm` (Biscuit tokens), Drizzle, shadcn. CI: nargo test, forge test, e2e (spin docker-compose, run scripted 3-institution flow via sdk).

---

## 8. Build phases (each ends demo-able)

*(Phase numbering and gates here are superseded by BUILD_SPEC §2/§8, which is the executable sequence — this section survives as scope narrative.)*

**P0 — Skeleton (foundation)**
Monorepo, anvil fork scripts, base contract with tree/root-history/nullifiers + one toy circuit (`cash_transfer`) verified on-chain, TS protocol package (commit/encrypt/prove round-trip). *Checkpoint: a private note moves on the fork via one script.*

**P1 — Ring core**
Node service: wallet, sync engine, projection store, note manager, Ledger API-lite, prover queue. Shield/unshield circuits + ShieldVault (real USDC on fork). Two Rings transfer cash via coordinator relay. *Checkpoint: institution-to-institution private USDC payment, API-only.*

**P2 — Identity & control plane**
Privy integration, org provisioning, invites + domain allowlist, RBAC + Biscuit issuance, four-eyes, whitelist, audit log. **ENS directory on Sepolia (Ring + department names) and the CCIP-Read employee resolver.** Dashboard shell: onboarding, portfolio, admin, inbox. *Checkpoint: flows I1, I3, I4 work (payroll I6 arrives with P3's circuits).*

**P3 — Bond + repo + payroll**
Circuits 4–11 (incl. `cash_fanout`/`entitlement_claim`), repo state machines in node, payroll run UI, blotter + registry UI, maturity automation (node cron + anvil time-warp). *Checkpoint: flows X2 (bond), X4 (repo full cycle), I6 payroll (server-proved claims; browser proving comes in P4).*

**P4 — Strategies + sponsor proving**
**Privy Earn on the public treasury (real chain)** — deposit/withdraw + live balance/APY in the Strategies UI, greyed private-strategies card beside it; **ProveKit browser proving for `entitlement_claim`**. *Checkpoint: flow B2 and I6's in-browser salary claim.*

**P5 — The show**
Public-view split panel, auditor export, seed data + `demo-reset` script, polish pass on dashboard (frontend-design skill), rehearse the §2 script, record backup run-through. *Checkpoint: full 10-minute demo, repeatable from clean state in one command.*

**Cut lines if pressed** (in order): repo default path → coupon fan-out (keep bond issue/DvP) → audit export UI (keep API) → Sepolia stretch (never was core). **Never cut**: split-screen public view, Privy onboarding + Earn, repo happy path.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| ProveKit immaturity (youngest tool, now load-bearing) | P0 gate decides day one; bb/Honk is the wholesale fallback — circuits are backend-agnostic Noir, flip is a half-day; vendor verifiers; CI regenerates and diffs |
| No bb-compatible Poseidon2 in Solidity/TS (parameter mismatch) | P0 byte-equality gate catches it day one; specified fallback: classic circom-parameter Poseidon trio (Noir stdlib poseidon ↔ poseidon-lite ↔ poseidon-solidity), BUILD_SPEC §3.1 |
| Proving too slow for live demo | Constraint budget per circuit (<50k); pre-warm proof for the riskiest step; honest "proving…" UI state (it's authentic!) |
| Multi-service demo fragility | docker-compose one-command bring-up; `demo-reset`; recorded backup video |
| Privy org/SSO complexity | Email-only auth is sufficient; domain allowlist enforced node-side, not via Privy orgs |
| Anvil fork drift (RPC rate limits, vault state changes) | Pin fork block number; cache fork state locally |
| Scope creep toward EXPLORATION.md production design | §3 simplifications list is the contract; anything beyond it needs a reason |
| Privy Earn can't run on a local fork (real-network service) | Chain-split per §11: Earn flows on a real chain from the Privy server wallet; small real USDC budget; spike in P0 |
| ENS names on a local fork aren't real ENS ("no hard-coded values" risk) | Register real names on Sepolia; directory resolves via Sepolia RPC, separate from settlement chain |
| ProveKit primitive portability (R1CS ≠ Barretenberg blackboxes) | P0 spike: confirm Poseidon2 + signature scheme compile via ProveKit; if Schnorr fails, secret-knowledge auth everywhere (specced); if Poseidon2 fails, circom-Poseidon trio (BUILD_SPEC §3.1) |
| Hackathon scope/rules mismatch (see §11 build-timing note) | Decide scratch-vs-continuity before writing code; maintain the weekend-cut list |

---

## 10. Out of scope (production roadmap, not PoC)

Kernel recursion & universal verifier (anonymity-set unification), shape padding, EIP-4844 mailbox, Groth16 wrap + ceremony, 4337/private relaying, HSM + M-of-N root, key rotation/recovery, decentralized oracles, Daml-compatible Ledger API, the DSL/compiler, mainnet deployment, legal wrappers (GMRA mapping), margin/substitution lifecycle, netting/derivatives, custody hierarchies, name-records-as-notes (namespace fully on-chain; CCIP gateway as stateless signer), FROST threshold party keys + in-circuit policy predicates (the "private Safe" — §5.1), Safe multisig as the production funding EOA, vLEI counterparty verification, issuer eligibility credentials enforced in-circuit (ZK KYC).

---

## 11. ETHGlobal NY prize targeting (3 sponsors, all replacing planned work)

Selection rule: an integration qualifies only if it *replaces something we already need* rather than bolting on.

| Sponsor | Prize target | What it replaces in this plan | Phase |
|---|---|---|---|
| **ENS** (~$5k creative + integrate pool) | "Most Creative Use of ENS" + "Integrate ENS" | **The entire identity layer — there are no accounts in this system, only names.** Public ENS carries only what's meant to be discoverable: Rings (`drw.eth`; text records → encryption pubkey, Ring endpoint, party root) and departments (`treasury.drw.eth` — propose to a department, their Ring routes internally). **Employees are offchain subnames served by a CCIP-Read gateway that is a component of the Ring software** (ERC-3668: the L1 resolver pins the org's signing key, so even a hosted gateway can't forge records). Employee labels are **capabilities, not a directory**: shared bilaterally, optionally unlisted (non-guessable), gateway rate-limited against enumeration — public handle vs unlisted is a per-employee disclosure choice. Product rule: **no hex addresses anywhere in the UI**. Production roadmap: name records as notes on-chain (gateway becomes a stateless signer over chain-derived data). | P2 (directory + CCIP resolver), beats 1 & 3 |
| **Privy** ($5k, "Best onchain financial product") | Embedded wallets + Earn | **Auth (already planned) + the public funding EOA** (Privy server wallet) + idle *unshielded* buffer earns via **Privy Earn**. Story: Earn IS the yield feature (it allocates to Morpho under the hood); the private-strategies card sits greyed beside it as roadmap. | P2 (auth/EOA), P4 (Earn) |
| **World** ($2.5k, Track D: ProveKit — **no World ID / login required**; track is purely the proving library) | Client-side proving for ONE circuit | **The entire proving stack.** ProveKit (Noir → R1CS → Groth16) is the PRIMARY prover for all 8 circuits — server-side in every Ring, and in the *browser* for the payroll claim (the employee's witness never leaves their device). Their qualification list (compile to R1CS, client-side Groth16, on-chain verification) describes our whole protocol, not a feature. Constraint: circuits use backend-portable primitives (Poseidon-first; Schnorr only if it compiles via R1CS). | P0 (stack decision) + P4–P5 (browser claim) |

Rejected as non-seamless: **Canton Foundation** (their repo track is literally our demo, but requires Daml on Canton DevNet, "no EVM wrappers" — a parallel codebase; visit the booth anyway), **Unlink** (competing privacy primitive), **Ledger** (four-eyes on a device is gorgeous but the track requires an AI agent), **Walrus** (real fit for ciphertext archival — alternate if a top-3 falls through).

Hackathon cut-priority interaction: ProveKit's primary target is the **payroll salary claim** (`entitlement_claim`, flow I6) — payroll keeps the fan-out circuits in the weekend cut, and "your salary never leaves your device" is the strongest framing. Bond coupons reuse the same circuits if they make it back in. Last-resort fallback: `cash_transfer` client-side.

**Chain-split reality (audit finding — both ENS and Privy Earn are real-network services and cannot run against a localhost fork):**
- **ENS**: register real names on **Sepolia** (full ENS deployment exists there); the directory/whitelist resolves via a Sepolia RPC, independent of the settlement chain. The directory was always logically separate from settlement, so this is clean — and it satisfies "functional, no hard-coded values" with real resolution. Note: we won't own `ubs.eth`/`drw.eth` even on Sepolia — register a parent we control (e.g. `aragorn.eth` on Sepolia) and run the cast as `ubs.aragorn.eth`, `drw.aragorn.eth`; the resolution path is identical.
- **Privy Earn**: runs through Privy's backend on real networks only. The public funding wallet (a Privy server wallet) lives on a real chain (Base/mainnet) with a small amount of real USDC for the Earn flow; only the *shielded* system lives on the fork. Narratively honest: the public treasury is on public rails anyway.
- Net: the demo spans three planes — settlement (Anvil fork), identity (Sepolia ENS), public treasury (real chain via Privy). Wire this in P0, not P4, so surprises surface early.

**Build-timing decision (audit finding — the plan's biggest unstated assumption).** ETHGlobal NY runs June 12–14; the full P0–P5 plan is multi-week scope. Two legal paths:
- **Scratch track**: code is written at the event. Design docs, architecture, circuit specs, and this plan are fair preparation — write *no code* before Friday, and execute the **weekend cut** below.
- **Continuity track**: pre-build now, declare it, and extend at the event — but our three prize targets are open-track; continuity eligibility for them must be confirmed with each sponsor at the venue before committing. (ENS has a separate $4k continuity prize as a fallback.)

**Weekend cut (the 36-hour version of this plan):** 2 institutions, not 3 (dealer doubles as bond issuer); circuits 1–3, 6–7, 8–10 — the BUILD_SPEC §0 set (strategy circuits cut with the Morpho decision; drop `repo_default` and `bond_issue`/`bond_dvp_accept` — seed the bond position directly, bond coupons ride the payroll circuits if time allows); coordinator folded into one process with the relayer; skip docker-compose (two node processes + anvil locally); dashboard = portfolio, blotter, admin-lite, split panel only. Everything else in P0–P5 is the *post-hackathon* PoC plan.

## 12. Open decisions (settle in P0)

1. ~~Final name~~ — DECIDED: project **Aragorn**, instances are **Rings** (§0).
2. ~~Morpho vault choice~~ — moot: direct Morpho integration cut; Privy Earn delivers Morpho yield.
3. Privy app config — **default: email-only** (Google SSO only if free).
4. Bond coupons — **default: skip**; payroll carries fan-out/claim. Revisit only if ahead of schedule.
5. Demo runtime — **default: all-local** (two node processes + anvil + Next dev). Vercel-hosted dashboard is a submission-link stretch, never the live-demo dependency.
