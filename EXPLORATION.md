# Canton on Ethereum Mainnet — Design Exploration

*An exploration of replicating Canton's institutional ledger model directly on Ethereum L1, using a UTXO note model, Noir circuits, and Daml-shaped abstractions. No code, just architecture.*

---

## 1. What Canton actually is, decomposed

Strip away the branding and Canton is five primitives. Each one needs an Ethereum-native equivalent:

| # | Canton primitive | What it does | Mainnet equivalent (proposed) |
|---|------------------|--------------|-------------------------------|
| 1 | **Daml contract (ACS entry)** | Immutable record, created once, consumed once ("archived"). Canton's Active Contract Set is explicitly UTXO-like. | A **note**: a commitment in an append-only Merkle tree, consumed by publishing a **nullifier**. Exactly the Zcash/Aztec model. |
| 2 | **Sub-transaction privacy** | Each party sees only the projection of a transaction it's a stakeholder of. Nothing is replicated globally. | On-chain: only commitments, nullifiers, and proofs (no data). Off-chain: encrypted note payloads delivered to stakeholders only. The "projection" becomes *which notes you can decrypt*. |
| 3 | **Daml templates + authorization** (signatories, observers, controllers, choices) | The smart contract logic, with party-based authorization checked by the ledger model itself | **Templates compiled to Noir circuits.** A "choice" is a circuit that proves: valid input notes existed, were authorized by the right parties' signatures, and the output notes follow the template's rules. |
| 4 | **Synchronizer (sync domain)** | Orders encrypted messages, timestamps, runs two-phase commit across participants. Sees no contract data. | **Ethereum mainnet itself.** L1 gives total ordering, atomicity, censorship resistance, and a neutral operator — which is precisely the role Canton's Global Synchronizer plays, except nobody has to govern a consortium. |
| 5 | **Participant node** | Party's self-sovereign compute/storage; holds keys, validates its projection, exposes the Ledger API | An **off-chain node** each institution runs: watches L1 events, trial-decrypts/tags notes, maintains the party's view of the ledger, orchestrates multi-party signing and proving, exposes a Canton-style gRPC/JSON Ledger API. |

The deep insight that makes this mapping work: **Daml's ledger model is already a UTXO model with privacy by projection.** Canton never had accounts or global state. So the translation to a commitment-tree/nullifier design is not a hack — it's arguably the *native* expression of the Daml ledger model in a public-chain setting. The thing Canton adds on top of plain UTXOs — multi-party authorization and need-to-know distribution — is exactly what ZK + encryption give you on a public chain.

---

## 2. Core architecture

### 2.1 The L1 base contract ("the synchronizer")

One singleton contract on mainnet (think of it as the shielded workflow VM):

- **Note tree**: append-only incremental Merkle tree of note commitments. A commitment is roughly `hash(template_id, template_version, payload_hash, stakeholder_set_hash, salt)`.
- **Nullifier set**: mapping of spent-note nullifiers, `nullifier = hash(note_commitment, note_secret)`, where the **note_secret travels in the encrypted payload to all stakeholders**. It cannot be a single owner's private key: under authority-from-contract (§6.1), a counterparty may legitimately consume a note you hold (the dealer consuming the lender's encumbered collateral at `Close`), so every party the template entitles to spend must be able to derive the nullifier. Consequence: stakeholders can detect when a shared note is consumed — which is exactly Canton's semantics (stakeholders see archival) — while unlinkability holds against everyone outside the stakeholder set. Double-spend = duplicate nullifier = revert. This is the entire concurrency-control story (more in §4.1).
- **Universal verifier**: one verifier for the kernel proof (§2.4), with template circuits verified *inside* the kernel recursively — template_id never appears on-chain. (A per-template verifier registry is simpler for v0 but partitions the anonymity set — see §2.7; treat it as scaffolding to be removed, not architecture.)
- **Root history**: the contract keeps a window of recent tree roots and accepts proofs against any of them. Without this, every proof would be stale on arrival — the root changes whenever someone else's transaction lands between your proving and your inclusion. (Spending an unconfirmed note from the same window also works: prove against the root your own pending insertion will produce.)
- **Transaction entrypoint**: `settle(proof, nullifiers[], new_commitments[], encrypted_payload_pointers[], public_inputs)`. Verifies the proof against a root in the history window, checks nullifier freshness, inserts commitments, emits events. Atomic: a multi-leg DvP either fully lands or fully reverts.

Everything on-chain is opaque. An observer sees "some valid workflow consumed and created notes" and nothing else — not the template (it stays inside the kernel proof), not the parties, not the values, and with shape padding (§2.7) not even the true input/output counts.

### 2.2 Templates as circuits — the central abstraction

This is where "the right abstractions" live or die. The goal is that a developer (or eventually a Daml-to-Noir compiler) writes something that *feels* like a Daml template:

```
template Ious
  issuer: Party     -- signatory
  owner: Party      -- signatory
  amount: Decimal
  choice Transfer (controller: owner, newOwner: Party)
    consumes this, creates Ious{issuer, newOwner, amount}
```

and it compiles to a Noir circuit whose public inputs are (nullifiers, new commitments, tree root) and whose private witness contains the note payloads, Merkle paths, and **party signatures**. The circuit proves:

1. **Existence**: input notes are in the tree at a known root.
2. **Authorization**: the controller of the choice signed this exact transition; every signatory of every *created* contract authorized it (Daml's authorization rule). Parties are keypairs; signatures are verified in-circuit (EdDSA/Schnorr over an embedded curve is cheap in Noir; ECDSA/secp256k1 is doable for institutional HSM compatibility, just costlier).
3. **Conformance**: output note payloads follow the template's logic given inputs and choice arguments.
4. **Nullifier correctness**: nullifiers are correctly derived from the note secret, so consumption is binding, and unlinkable to the commitment for anyone outside the note's stakeholder set.

Daml concepts map cleanly:

- **Signatory** → key whose signature is required in-circuit for create/archive.
- **Observer** → key added to the note's encryption recipient set (sees, can't act). This is wonderful: *observer-ship is literally just "who gets the decryption key."*
- **Controller/choice** → a circuit (or circuit branch) gated on that party's signature.
- **Contract key / lookups** → hard; see §4.5.
- **Divulgence / explicit disclosure** → sender includes extra recipients in the encrypted payload distribution.

### 2.3 Privacy distribution: who learns what, and how

- **On-chain**: commitments + nullifiers + proof. Zero business data.
- **Payload delivery**: encrypt the note payload to each stakeholder's encryption key (ECIES, note-tag scheme so recipients can detect their notes without trial-decrypting everything). Two delivery options:
  - **Blobs (EIP-4844) as the mailbox**: ciphertexts in blob space, cheap, and crucially gives you *guaranteed* delivery semantics tied to the transaction — a counterparty can never claim "I didn't get the data." Blobs expire (~18 days), so participants must sync within that window or fall back to peer resend. This mirrors Canton's sequencer-as-message-bus role nicely.
  - **Off-chain delivery (P2P / shared store) with on-chain payload_hash**: cheaper, but reintroduces a data-availability dispute surface between counterparties. Probably fine between institutions with bilateral agreements; wrong default for open use.
- **Selective disclosure / audit**: per-party **viewing keys** (institution hands its auditor a read-only key scoped to a time range or template set), or per-contract disclosure (re-encrypt one note's payload to a regulator on demand, provably matching the on-chain commitment). This is *better* than Canton's story in one way: disclosure is cryptographically verifiable against L1, not trust-the-node.

### 2.4 Composability between templates: the kernel question

Daml's killer feature is atomic workflows across templates (DvP: a bond note and a cash note swap atomically). Two ways to get this:

- **Monolithic choice circuits**: a DvP is its own circuit touching both templates. Simple, but O(n²) circuit explosion and no open composability — you can't write a new workflow over someone else's deployed template without their circuit cooperating.
- **Kernel recursion (the Aztec design, and the right one)**: each template-choice produces a small proof; a **kernel circuit** recursively verifies a stack of them and enforces cross-call consistency (this is exactly what Aztec's private kernel does, and Noir is built for this recursion). The L1 contract then verifies *one* kernel proof per transaction regardless of workflow complexity. This is the Canton transaction-tree model — a transaction is a tree of exercises — expressed as a proof tree. Strongly recommend designing for this from day one even if v0 ships monolithic circuits.

### 2.5 The transaction lifecycle (Canton's two-phase commit, reborn)

Canton's protocol: submitter builds the transaction tree → synchronizer distributes encrypted views → stakeholders confirm → commit. On mainnet, phase-1 moves entirely off-chain and L1 *is* the commit:

1. **Propose**: initiating participant node constructs the transaction (which notes consumed/created), and sends each counterparty its *projection* for approval over an off-chain channel.
2. **Authorize**: each required signatory's node validates its projection against its own ledger view and **signs the transition** (a signature over the note commitments / transition hash — not an L1 transaction). This is Canton's confirmation phase. Crucially, signing is cheap and HSM-friendly; only one party needs to prove.
3. **Prove**: the submitter (or a delegated prover — see threat note in §4.2) generates the Noir proof embedding everyone's signatures.
4. **Settle**: one L1 transaction, sent via a relayer/4337 bundler so the submitter's identity isn't leaked by gas payment. Ethereum's ordering resolves races; inclusion = commit; finality = ~2 epochs.

Asynchronous multi-party workflows (offer/accept over days) don't need any of this coordination machinery — they're just sequential single-signer transactions over propose/accept notes, exactly like Daml's propose-accept pattern. The interactive flow is only needed when you want *atomic* multi-signatory commits, same as Canton.

### 2.6 The participant node illusion (core product principle)

**Institutions must never see a UTXO.** The participant node is not a thin wrapper over the chain — it is the product, and its job is to present a fully Canton-shaped experience: a private, permissioned ledger that happens to settle through public cryptographic machinery. The UTXO/note layer is an implementation detail at the same level as Canton's own commitment hashes — present in the protocol, absent from the API.

The illusion is built in four layers:

**1. The API speaks contracts, not notes.** The node exposes a Canton-style Ledger API: create contracts, exercise choices, stream transactions, query the Active Contract Set. A "contract" in the API is a stable logical object with a contract ID; underneath, the node maps it to a note commitment (and remaps it when, e.g., a fungible position gets split/merged across notes). Coin-selection, note splitting, change notes, Merkle paths, nullifiers — all handled by an internal **note manager** the institution never sees. Aim for Daml Ledger API compatibility so existing Canton/Daml integrations port over.

**2. The projection store is their system of record — physically.** Only payloads the institution's keys can decrypt ever enter their database. This is the crucial upgrade over "permissioned": in a permissioned DB or consortium chain, privacy is a *policy* enforced by someone else's access control; here, the cleartext of a contract **physically exists only on stakeholder nodes**. There is no operator, no super-validator, no cloud provider who could be subpoenaed, breached, or socially engineered into revealing it, because they don't have it. The permissioned *feel* is backed by a stronger fact than any permissioned system can offer. Their Postgres, their infra, their data — and the chain holds only opaque commitments.

**3. Permissioning is node-local, exactly like Canton.** Parties are hosted on the node; human users and systems authenticate to the node with ordinary enterprise auth (OIDC/JWT) and get act-as / read-as claims per party. The chain never learns that users exist — it only ever sees party keys, and those only inside proofs. Internal entitlements, four-eyes approval flows, desk-level segregation: all node-side, all conventional IT.

**4. The chain-facing machinery is invisible plumbing.** Proving, relayer submission, gas (the institution gets an invoice or a prepaid relayer balance, never a wallet), blob-mailbox sync, ciphertext archival, projection rebuild after disaster recovery — all node responsibilities. Settlement states surface in the API as Canton-like statuses: `in-flight → committed → final`.

**Where the seams show (and how to dress them):**

- **Contention**: two workflows consuming the same contract → one fails. Canton has exactly this error class (`LOCKED_CONTRACTS` rejections), so surface it in the same vocabulary — "contract was archived by a concurrent transaction, retry" — and let the note manager auto-retry with fresh inputs where the template allows. Daml developers already write for this.
- **Latency**: `committed` arrives in ~12s, `final` in ~13min. Canton apps usually act on commit; expose both and let risk policy choose.
- **Throughput shaping**: the node batches and paces L1 submissions; under load, commands queue node-side rather than failing — feels like any enterprise message bus.
- **Onboarding**: the one unavoidably crypto-flavored ceremony is party key generation in the HSM and (optionally) registering in a party directory. Make it a one-time, well-documented ritual; everything after is normal software.

The deepest version of this principle: an institution should be able to adopt the system, integrate it with their back office, pass an audit, and run it for a year **without anyone in the building needing to know what a nullifier is** — while their lawyers independently verify that settlement finality and data custody are cryptographic facts on Ethereum, not promises from an operator.

### 2.7 One anonymity set, shared by everyone (design requirement)

Every institution and every workflow must contribute to — and draw from — a **single global anonymity set**. This is a stated requirement, not an emergent property, because the default engineering path partitions it. The rules:

1. **One singleton contract, one note tree, one nullifier set, for all templates and all institutions.** A repo leg, a bond issuance, and a payroll run all insert commitments into the same tree and publish nullifiers into the same set. Commitments and nullifiers are uniform hashes — nothing about them reveals template, asset, party, or size. (This is Aztec's "one global note tree shared by every app" decision, and it's the right one.) Never deploy per-asset or per-consortium instances: ten "private repo networks" with their own trees are ten small, fingerprintable crowds instead of one large one.
2. **Template identity stays inside the proof.** If each template has its own on-chain verifier, every transaction publicly announces "this was a repo-template exercise" — the anonymity set collapses to per-workflow buckets. The kernel design (§2.4) fixes this: the L1 contract verifies one universal kernel proof; *which* template circuits ran is private witness data. This upgrades the kernel from a composability feature to an anonymity requirement.
3. **Uniform transaction shape.** Pad nullifier/commitment counts to fixed buckets (e.g. powers of two) and pad ciphertext blobs to standard sizes, so a 2-in/2-out payment is indistinguishable from a 4-in/5-out repo on-leg. Cheap insurance against shape-fingerprinting.
4. **Shared submission path.** All transactions enter via the relayer/paymaster layer with no institution-identifying gas wallets; relayers batch and pace submissions to blunt timing correlation. An institution that runs its own dedicated relayer is signing its transactions with its IP address.
5. **The boundary is where anonymity is spent.** Shield/unshield events (ERC-20 in/out) necessarily reveal asset type and amount, and compliance association sets (Privacy Pools) deliberately segment *that* boundary. Fine — segment at the door, never inside the room. Once value is shielded, it lives in the one undivided set.

The economics follow: **each new institution makes every existing institution's privacy stronger.** A repo desk's transactions hide among bond settlements, payments, and everyone else's repos. That's a network effect Canton structurally cannot offer — Canton's privacy is isolation (your data distributed to fewer people; domains seeing their own metadata), whereas this is privacy as a commons (your activity hidden in everyone's crowd). It also gives competitors a positive-sum reason to share infrastructure: more counterparties on the same tree is not a leak, it's cover.

---

## 3. How it feels

### For institutions

- **You run a participant node, not a blockchain.** Same operational shape as Canton: a service that holds your party keys (in your HSM), syncs your projection from L1 events + blob payloads, and exposes a Ledger API your existing systems integrate with. You never see — and never store — anyone else's business data. Your database *is* your books and records, anchored to a public chain.
- **No consortium, no membership.** Versus Canton's value proposition this is the sharpest difference: there's no Global Synchronizer Foundation, no super-validator set, no permissioning committee. Settlement neutrality comes from Ethereum. Onboarding is: generate keys, fund a relayer relationship, start transacting. Conversely — there's no one to call, no SLA, and no governance forum where you have a vote. Some institutions count that as a feature, others absolutely do not.
- **Settlement finality is Ethereum finality**: ~12s inclusion, ~13min economic finality. Slower than Canton's sub-second confirmation within a domain, but it's *public, jurisdiction-neutral* finality with the deepest security budget in the industry — and legal teams increasingly know how to reason about it.
- **Compliance posture**: auditor viewing keys, provable per-contract disclosure, and (recommended) Privacy-Pools-style association sets at the asset-shielding boundary so institutions can prove their funds don't commingle with sanctioned flows. Privacy from competitors, transparency to regulators — the Canton pitch, with stronger cryptographic receipts.
- **Costs**: each settlement is an L1 transaction. Order of magnitude: a wrapped/aggregated proof verification (~300k gas Groth16-wrapped; ~1.5–2M unwrapped Honk — wrap it) plus state writes and blob fees → very roughly $2–20 per workflow commit at typical gas. Fine for securities settlement, treasury, syndicated lending; wrong for retail payments. Batch aggregation (one proof carrying N transactions, submitted by an aggregation service) cuts this 10–100× at the cost of introducing a (trustless, but operational) aggregator role — that's the moment you've quietly invented an L2, which is a slider to be honest about (§5).
- **What's worse than Canton, honestly**: latency under contention; per-transaction cost; no built-in identity layer (Canton parties come with an operator-attested namespace — here you need a party registry / VC layer as a sibling abstraction); key loss is catastrophic without explicit social-recovery or re-issuance choices in templates; and public mempool timing metadata leaks *that* something settled even if not *what* (mitigate with relayers + steady-rate batching).

### For users (humans at the edges of these workflows)

- Privacy is the default, not a mode. Your bond position, your loan, your invoice — nobody can see it, including the people running infrastructure.
- **Client-side proving is now genuinely fine**: Noir/Barretenberg proves typical circuits in seconds on a laptop or phone (Aztec's client-side proving work has pushed this hard). The UX is "review → sign → ~5–15s spinner → settled next block."
- The wallet feels like an app account, not a crypto wallet: notes are discovered and decrypted automatically by your node/wallet; balances are sums over your notes; gas is invisible (paymaster); addresses are stealth-style one-time keys so even your counterparty list isn't on-chain.
- The sharp edges: you must keep keys (viewing key loss = you can't *see* your own assets; spending key loss = you can't *move* them — recovery design is a first-class product decision), and contentious shared state (e.g. subscribing to a hot offer note) can fail with "someone got there first," which needs honest UX.

---

## 4. The hard problems (and positions on each)

### 4.1 UTXO contention
Two parties consuming the same note race on the nullifier; loser reverts after paying gas. Canton solves this with synchronizer-level conflict detection. Mitigations: (a) design templates to shard hot state (per-party notes, not shared counters — Daml developers already think this way); (b) propose-accept patterns serialize naturally; (c) for genuinely hot shared state, an intent/solver pattern where a coordinator orders intents off-chain and settles batches. Position: accept it, design templates around it; it's the same discipline Daml already teaches.

### 4.2 Who generates the proof learns everything
The prover sees the full witness. Fine when the submitter is a stakeholder (usual case). For delegated/server proving (mobile users, big circuits), you leak to your own prover — keep proving client-side or within the institution's own infrastructure. True collaborative proving (MPC provers) exists in research; don't depend on it.

### 4.3 Note discovery & data availability
Recipients must find their notes. Blob mailbox + note tags solves discovery and delivery atomically with settlement; the 18-day blob window means participant nodes must sync regularly or rely on peers/indexer services for history. An institution-grade product needs an archival story (e.g. each participant archives ciphertexts it can decrypt; bilateral resend obligations in rulebooks).

### 4.4 Template upgrades & governance
Circuits are forever; bugs are forever-er. Need template versioning in the commitment scheme plus explicit migration choices (signatories authorize moving a note from template v1 → v2 — pleasingly, this is exactly Daml's upgrade-by-consent model, now cryptographically enforced). Avoid any admin key that can swap verifiers under existing notes — that's a backdoor to everyone's assets.

### 4.5 Contract keys / lookups
Daml's "find the contract where key = X" requires global state queries, which conflict with privacy. Punt: support keys only within a party's own projection (node-local index), and use on-chain registries only for genuinely public reference data.

### 4.6 The asset boundary
Real value enters by shielding ERC-20s/RWAs into notes via the base contract. The shield/unshield boundary is where privacy leaks (amounts, parties) and where compliance applies (association sets, screening). Treat it as a first-class, carefully-designed module, not plumbing.

---

## 5. Prior art, and where this actually sits

- **[Aztec](https://aztec.network/)** — alpha mainnet live since March 2026; private smart contracts, Noir, notes/nullifiers, kernel recursion, client-side proving. This *is* "Canton-shaped privacy for Ethereum" — **as an L2 with its own sequencer set, token, and trust surface.** The honest framing: ~80% of the cryptographic architecture described above is Aztec's architecture.
- **[EY Nightfall_4](https://www.ey.com/en_gl/newsroom/2025/04/ey-upgrades-nightfall-a-zero-knowledge-roll-up-enabling-private-transactions-on-the-ethereum-blockchain)** — enterprise ZK rollup for private *transfers* (now also on Starknet). Validates institutional demand, but it's payments-shaped, not workflow-shaped: no multi-party authorization model, no template abstraction.
- **Railgun / Zcash / Privacy Pools** — shielded value transfer + the compliance vocabulary (association sets) worth adopting at the shield boundary.
- **[Canton Network](https://www.canton.network/protocol) itself** — the semantics target. Its weaknesses from a public-chain view: permissioned synchronizer governance, trust-the-participant validation rather than proofs, and a consortium to join.

**So what's the differentiated wedge for "Canton on mainnet"?** Three things Aztec doesn't give you:

1. **L1-native settlement with no new trust layer.** No sequencer, no rollup governance, no bridge, no token dependency. For an institution whose lawyers have signed off on Ethereum mainnet and nothing else, that's the whole ballgame. The cost is throughput and latency — which institutional workflows (settlement, issuance, syndication) tolerate far better than DeFi does.
2. **Workflow semantics, not app semantics.** Aztec gives you private *programs*; Canton's enduring idea is the *authorization-first ledger model* — signatories, observers, choices, projections, propose-accept — which is how financial agreements actually work. Building that abstraction layer (a Daml-flavored DSL or library compiling to Noir circuits + the participant-node/Ledger-API runtime) is the genuinely novel artifact here, and it could even target multiple proving backends/venues later.
3. **The participant node as the product.** Institutions don't buy circuits; they buy a node with a Ledger API, an audit story, and books-and-records semantics. That whole layer is unbuilt for the mainnet-native design.

There's a slider here worth naming: **pure L1 settlement** (every workflow = one L1 tx; simplest trust story, ~$2–20/commit) → **proof aggregation service** (trustless batching, 10–100× cheaper, new operational role) → **based/sovereign rollup** (cheaper still, but now you're competing with Aztec on their turf). Recommendation: design the abstractions so the venue is swappable, ship v0 pure-L1 where the trust story is cleanest and the institutional pitch sharpest.

---

## 6. Worked example: a bilateral repo

The flagship Canton workload (Broadridge DLR settles >$1T/day of repo on Daml). If the system can do a repo end-to-end, it can do most of institutional finance. A repo is: Dealer sells securities to Lender for cash, with a binding agreement to repurchase at maturity at price + repo rate. Two atomic DvP legs plus lifecycle in between.

### 6.1 The one new abstraction repo forces: authority-from-contract (encumbered notes)

In Daml, the lender's consent to *return the collateral at maturity* isn't a signature the lender gives later — it's authority carried by the `RepoAgreement` contract itself (lender is signatory; the dealer-controlled `Close` choice's consequences are authorized by both signatories). The UTXO translation: a note's spending predicate can require, instead of a bare owner signature, **that the same transaction consumes a specific governing note whose template logic approves the spend**.

So the collateral the lender holds during the repo term is an **encumbered Security note**: spendable only in a transaction that also exercises `Close` or `Default` on RepoAgreement #N. The kernel circuit enforces the cross-note linkage. This is the essence of Daml expressed in circuits — *authority flows from contracts, not just keys* — and it's the abstraction that separates this system from every shielded-payments design (Zcash, Railgun, Nightfall), none of which can express it.

### 6.2 Templates

- `Cash` — issuer, owner, amount (shielded tokenized deposit / stablecoin at the asset boundary)
- `Security` — registrar, owner, ISIN, face amount; optionally encumbered (see above)
- `RepoProposal` — full economic terms: ISIN, quantity, purchase price, repo rate, day count, start/end date, haircut. Signatory: dealer. Controller of `Accept`: lender
- `CollateralAllocation` — dealer's securities locked pending accept-or-withdraw
- `RepoAgreement` — the live repo; signatories: both. Choices: `Close` (dealer), `Default` (lender, time-gated), `Substitute` (dealer, against an in-terms eligibility schedule), `MarginCall` (either, against an oracle price attestation)

### 6.3 Leg by leg

**On-leg (proposal → atomic DvP).**
1. Dealer's node creates `RepoProposal` and — in the same transaction — consumes dealer `Security` notes into a `CollateralAllocation` (note manager does coin selection + change invisibly). This is the **allocation pattern**: locking collateral at proposal time means the lender's later `Accept` needs *no live dealer signature* — the dealer's authority was committed up front, with a unilateral `Withdraw` escape hatch if the lender never accepts. (Alternative: interactive co-signing per §2.5 — no lockup, more coordination. Allocation is how real DvP engines work; default to it.)
2. Lender's node receives the proposal payload via the blob mailbox, surfaces it in the lender's transaction stream; their credit/limits checks run node-side.
3. Lender exercises `Accept`. Their node builds one transaction: consume [proposal, allocation, lender `Cash` notes] → create [encumbered `Security` → lender, `Cash` → dealer, `RepoAgreement`, change notes]. One kernel proof, one relayed L1 settle. **Atomic DvP: there is no moment where one side has both legs.**
4. Both nodes decrypt their payloads and update projections. Dealer's API: cash +P, securities out on repo, agreement active. Lender mirrors. Public observers see k nullifiers and m commitments — not that it's a repo, not the rate, not the parties. (Repo rates are competitively sensitive; on Canton the synchronizer operator still sees metadata — here, less.)

**Term lifecycle.**
- *Time*: circuits can't read clocks, and the prover can't know the inclusion block's timestamp in advance. So the proof carries a **claimed time bound** as a public input (e.g. "this transition is valid for any time ≥ T"), the circuit proves the template condition against T (`maturity ≤ T` for Close, `maturity + grace ≤ T` for Default, `T ≤ attestation_time + freshness` for oracle data), and the base contract checks the bound against `block.timestamp` at execution. Maturity and default-grace gating become provable conditions without the prover ever guessing a block time.
- *Interest*: computed **in-circuit** from the agreement's terms — repurchase price = P × (1 + rate × days/360). The circuit refuses a `Close` with wrong consideration; no reconciliation dispute is possible.
- *Margin / substitution*: require a price. An agreed oracle party publishes signed price attestation notes; the `MarginCall` circuit verifies the oracle signature + freshness (timestamp input). Substitution swaps collateral atomically against the eligibility schedule baked into the agreement at trade time.

**Off-leg (`Close`).** At maturity the dealer's node — typically via node-side automation, the Daml-trigger equivalent — exercises `Close`: consume [`RepoAgreement`, dealer `Cash` for P+interest, lender's encumbered `Security`] → create [`Cash` → lender, unencumbered `Security` → dealer]. The encumbered note releases because the governing agreement is being exercised correctly — the lender does nothing and *needs to do nothing*; their consent was given at accept time, enforced by mathematics since.

**Default path.** If maturity + grace passes unclosed, the lender exercises `Default` (time-gated in-circuit): consumes the agreement, converts the encumbered `Security` into an unencumbered one owned outright by the lender, and emits a `DefaultNotice` note observed by the dealer. The GMRA legal wrapper maps these choices to its remedy clauses — the on-ledger part needs no court, and the off-ledger part has a cryptographic evidence trail.

### 6.4 What the institution experiences

Trader books the repo in the OMS → OMS calls the Ledger API → node-side four-eyes approval applies the party signature → counterparty sees the proposal in their feed and accepts → both back offices see `in-flight → committed → final` and reconciled positions in their own projection stores. Maturity close is automated. The auditor's viewing key covers the whole history. **At no point did anyone *inside the institution* see a note, a nullifier, coin selection, an encumbrance predicate, or gas** — the node translates contracts↔notes the way a TCP stack hides packets.

To be unambiguous about where settlement happens — **every note movement is an Ethereum transaction.** The accept leg on Etherscan is a real call to the base contract: a bucket of nullifiers published and commitments inserted (padded per §2.7, so the counts don't fingerprint the workflow), one proof verified, blobs of ciphertext, gas paid by a relayer. The nullifier set in L1 storage *is* the ownership record; if that transaction doesn't land, nothing has moved, and there is no off-chain version of ownership to fork from it. The public sees and Ethereum *enforces* every movement (double-spend prevention, DvP atomicity, ordering); stakeholders alone can decrypt the contents; institutional users see only contracts. Three audiences, one ledger.

### 6.5 Node sovereignty: who controls the UTXOs

The control hierarchy, mirroring Canton's namespace model:

```
Institution root key (HSM, M-of-N officer quorum)
  └─ party keys: BankA::repo-desk, BankA::treasury, BankA::ops   (derived/certified by root)
       └─ users & systems: traders, OMS, automation              (OIDC entitlements: act-as / read-as)
```

- **Every note owned by the institution's parties is spendable only under keys descending from the institution's root.** Traders never hold keys; they hold *entitlements* — the node applies the party signature only after node-side policy (limits, four-eyes, desk segregation) passes. The chain sees one party signature and neither knows nor cares what governance produced it.
- **Ownership is real and portable**: export the root key material + ciphertext archive, stand up a new node on any infrastructure, and every position is intact and spendable. No vendor, operator, or counterparty can freeze, censor, or even *see* the institution's book. (Honest caveat: regulated asset templates will carry issuer-level controls — a tokenized deposit's issuer can freeze *that asset class* by template design. That's a property of the asset, chosen at issuance, visible in the template — not a property of the platform.)
- **Key compromise/rotation**: root certifies new party keys; a `Rekey` choice (authorized by root) migrates notes to fresh keys — the institutional analogue of Canton topology transactions.
- The deep point: *the institution is the root of authority; the node is replaceable software; the chain is a neutral commit log.* Control over "their" participant node isn't an access-control promise — it's key custody.

---

## 7. Beyond repo: the rest of the institutional catalogue

What institutions actually run on Canton today, and how each maps. The headline: **almost everything reuses the repo machinery** — propose-accept, allocation, encumbered notes, oracle attestations, time bounds. Only two genuinely new patterns appear in the whole catalogue (fan-out entitlements and re-encumbrance).

### 7.1 Digital bond issuance & lifecycle (GS DAP-style)

- **Issuance**: issuer + registrar create the bond terms note; primary distribution is N propose-accept DvPs against investor cash. One transaction can carry many position notes (kernel handles batching).
- **The registrar model survives intact, and shows privacy is *per-template policy***: a `BondPosition` note has issuer/registrar as signatory or observer — so the registrar sees the full holder ledger (as bonds legally require), while **holders are invisible to each other** and the position is invisible to the public. Privacy isn't all-or-nothing; the template declares who sees what, exactly like Daml signatory/observer lists.
- **Coupons force the first new pattern: fan-out entitlements.** A naive "holders claim from one funded coupon-pool note" puts every holder in a nullifier race on the pool (§4.1). Instead the issuer's node, at coupon time, mints one `CouponEntitlement` note per holder in a batch transaction (it knows the holder ledger — it's the registrar). Each holder redeems independently, zero contention. One-to-many lifecycle events become fan-out-then-claim. Redemption at maturity: same pattern, consuming the position.

### 7.2 Collateral mobility & margin (the DTCC-pilot use case)

The marquee Canton pilot: pledge tokenized MMF shares to a CCP as margin in minutes instead of days. This forces the second new pattern: **re-encumbrance — changing what governs a note without moving ownership.**

- `Pledge`: convert an unencumbered MMF note into one encumbered to `MarginAgreement #N` (with the CCP). Ownership never changes; only the governing reference does. The owner keeps the economics (dividends via fan-out entitlements!); the CCP gains a time-gated `Seize` choice (default path, same shape as repo's).
- `Substitute` / `Release`: atomically swap or remove the encumbrance by exercising the governing agreement. Intraday margin calls: oracle price attestation → `MarginCall` → pledge top-up, all in one atomic transaction.
- Generalization worth designing in from the start: an encumbrance is a *pointer field in the note payload*, and the kernel enforces "a transaction touching this note must also exercise the pointed-to agreement." Repo collateral, CCP margin, and securities lending are then the same mechanism with different agreement templates.

### 7.3 Intraday FX swaps / PvP settlement (360T-style)

Structurally a repo with cash on both legs: near-leg PvP (EUR notes vs USD notes, atomic), far-leg PvP at maturity, enforced by the same agreement-note machinery. **No new primitives at all.** PvP atomicity — the thing CLS exists to provide — falls out of `settle()` being atomic. The only real dependency is good shielded cash: tokenized deposits or natively-issued shielded stablecoins on both currency legs.

### 7.4 Securities lending (HQLAᵡ-style)

Repo's open-term cousin: `LoanAgreement` with `Recall` (lender, any time), `Return` (borrower), `Rerate` (fee changes, bilateral or oracle-indexed), collateral via the §7.2 encumbrance mechanism. Agency lending adds the agent as a party on the agreement with its own choices. Pure reuse.

### 7.5 Tokenized funds: subscription & redemption

- `SubscriptionRequest` (investor cash allocated, §6.3 pattern) → transfer agent batches at NAV strike: one transaction consumes the day's requests + an oracle NAV attestation, issues `FundShare` notes at the struck price. The transfer agent serializes the day's flow, so no contention; investors don't see each other's orders (they're not stakeholders of each other's requests) — an improvement on most TA stacks.
- Redemptions mirror, with gating choices for notice periods (time bounds).
- This is the use case where issuer-side asset controls (§6.5 caveat) are normal and expected: fund shares are registered instruments; the template says so.

### 7.6 Custody hierarchies

Maps with almost embarrassing elegance, because Canton's party-hosting model *is* this system's node model:

- **Segregated custody**: each client is a party (`Custodian::clientX`) hosted on the custodian's node; client assets are notes owned by the client party; the custodian's node applies signatures under client instruction (entitlements, §6.5). The client can *leave* — re-host the party keys elsewhere — which is portable custody no traditional setup offers.
- **Omnibus custody**: the custodian's own party owns the notes; client allocations live in the custodian's projection-store-adjacent books. The on-ledger/off-ledger boundary is exactly where the legal boundary already is.
- Sub-custody chains are parties-on-nodes all the way down.

### 7.7 Derivatives post-trade (IRS lifecycle, netting)

- A long-lived bilateral `Swap` agreement note evolving through `Reset` choices (oracle rate attestations) that mint `PaymentObligation` notes.
- **Payment netting**: consume the period's obligation notes in both directions, create one net cash movement — a many-to-one batch circuit the kernel composes naturally. Portfolio compression is the same shape at trade level.
- The deep fit: derivatives post-trade is *workflow*, not transfer — confirmations, lifecycle events, collateral annexes (§7.2 again, as the CSA). It's the least "token-like" use case and the one where the authorization-first model earns its keep most.

### 7.8 The cross-application dividend

On Canton, atomic composition *across* applications requires both apps to share (or bridge) a synchronizer — it's the Global Synchronizer's whole raison d'être, and it's governed. Here, **every template lives in one tree under one kernel**: a bond from the §7.1 app pledged as margin in the §7.2 app inside an FX-settled package from §7.3 is *one atomic transaction* with no committee's permission. Composability across institutional apps is the default, not a roadmap item — and per §2.7, every one of these use cases is also feeding the same anonymity set, so the catalogue compounds: each new workflow class makes every other one more private.

### 7.9 Scorecard

| Use case | Reuses | New primitive needed |
|---|---|---|
| Bond issuance & lifecycle | propose-accept, DvP, observers-as-registrar | **Fan-out entitlements** (coupons) |
| Collateral / margin | encumbered notes, oracle attestations, time gates | **Re-encumbrance** (pledge without transfer) |
| Intraday FX / PvP | repo machinery with cash both legs | none |
| Securities lending | repo + encumbrance | none |
| Tokenized funds | allocation, oracle NAV, batching | none (TA serializes) |
| Custody | party hosting, entitlements, key portability | none |
| Derivatives post-trade | agreement notes, oracle resets, batch circuits | netting circuit (kernel composition) |

Two new patterns across the entire institutional catalogue. The primitive set — notes, templates-as-circuits, authority-from-contract, propose-accept, allocation, fan-out, re-encumbrance, oracle attestations, time bounds — appears to be *complete* for institutional finance. That's the strongest evidence yet that the abstraction layer is the right product.

---

## 8. If this moves forward — suggested shape of v0

1. **The template abstraction first** (paper design): party model, note format, authorization rules, one worked example (IOU with issue/transfer/settle choices) hand-written in Noir.
2. **L1 base contract**: note tree + root history + nullifiers; Groth16-wrapped Honk proofs for gas (wrapping the *kernel* means only one Groth16 circuit ever needs a trusted-setup ceremony). A per-template verifier registry is acceptable scaffolding on testnet only — it partitions the anonymity set (§2.7) and must be gone before anything touches mainnet.
3. **Minimal participant node**: event sync, blob mailbox decryption, projection store, propose/authorize flow over a simple transport, Ledger-API-ish surface.
4. **One end-to-end workflow on Sepolia**: two institutions, DvP of a mock bond vs mock cash, with an auditor viewing key. That demo *is* the pitch.

Open decisions to settle before code: signature scheme for parties (HSM-friendly secp256k1 vs circuit-friendly EdDSA — or both, per party), blob mailbox vs off-chain DA default, how early to ship kernel recursion (it's required for mainnet per §2.7 — the only question is whether v0-on-testnet earns the shortcut of monolithic circuits first), and whether the template layer is a Noir library (pragmatic) or a DSL/compiler (ambitious, the real moonshot).
