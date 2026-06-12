# Aragorn — Pitch Deck Copy (condensed)
*ETHGlobal NY 2026. Paste-ready slide text: 2 technical slides + 1 per sponsor.*

---

## Slide 1 — How It Works: Encrypted UTXOs You Own

# Every position is an encrypted UTXO. You hold it, you control it, you prove it.

- **Institutions create UTXOs they own and control.** A cash balance, a bond position, a repo agreement — each is a note whose actual data (amount, terms, parties) stays **encrypted, held only by its owners**. The chain stores just a hash of it (a commitment) in one shared Merkle tree.
- **Spending = a zero-knowledge proof of ownership.** To move a note you prove — revealing nothing — that it exists in the tree, that your keys authorize spending it, and that the outputs follow the rules (value conserved, terms respected). The chain verifies the proof and marks the note spent via a nullifier: double-spends impossible, contents invisible.
- **Sharing = encrypting to other people.** A trade isn't hidden *from* your counterparty — the note payload is encrypted to every stakeholder's key. Both sides of a repo decrypt the same agreement; an auditor gets a viewing key. Everyone else on earth sees a gray hash.

**SPEAKER NOTE:** Three moves — create encrypted UTXOs you own, prove ownership in zero knowledge to spend them, encrypt to counterparties to share them — that's the whole protocol; everything else is built from it.

---

## Slide 2 — How It Works: Contracts That Enforce Themselves

# Notes can be governed by other notes. Agreements execute in math, not in trust.

- **Encumbrance:** a note's spending rule can require more than a signature — repo collateral is spendable *only* in a transaction that correctly exercises Close on its governing agreement note. The lender consents once, at accept; the circuit enforces it forever after.
- **Atomic DvP:** cash and collateral swap in one proof, one Ethereum transaction — no moment where one side holds both legs. At maturity, close fires automatically with interest computed **inside the circuit**: *a wrong number cannot verify*.
- **The Ring node makes it usable:** each institution runs a sovereign node that holds the keys, decrypts its notes, generates proofs, and enforces policy (roles, limits, four-eyes) before signing. Humans get authorization, never keys — *the chain never knows users exist*. The database is disposable: `ring resync --from-zero` rebuilds the whole book from chain ciphertexts.

**SPEAKER NOTE:** This is the step beyond private payments — authority flows from contracts, not just keys — and it's exactly what we demo live with the full repo lifecycle ending in an automatic, math-enforced close.

---

## Slide 3 — ENS

# There are no accounts in this system. Only names.

- ENS is the **entire identity layer**: institutions are names (`ubs.aragornrings.eth`), resolved live from Sepolia — **ENSv2-native**, records on an owner-deployed PermissionedResolver. The counterparty whitelist is a list of names. **No hex anywhere in the product.**
- Employees are **CCIP-Read (ERC-3668) subnames** (`cat.ubs.aragornrings.eth`) served and signed by the Ring's own gateway — the L1 resolver pins the org's signing key, so even a hosted gateway can't forge a record.
- Employee names are capabilities, not a directory: shared bilaterally, optionally unlisted, rate-limited against enumeration. Roadmap: name records as notes on-chain, gateway becomes a stateless signer.

**SPEAKER NOTE:** ENS didn't replace a feature, it replaced the account model — payroll pays `cat.ubs.aragornrings.eth`, the whitelist resolves `drw.aragornrings.eth` live, and no user ever sees an address.

---

## Slide 4 — Privy

# No wallets anywhere — by design. Privy is the entire human layer.

- **Auth:** everyone signs in with institutional email via Privy — founding admin, domain-restricted invites, every role. No seed phrases, nothing phishable, nothing that leaves with an employee. The Ring holds the chain keys; people hold authorization. (This is Canton's own no-end-user-wallets model, with consumer-grade onboarding in front.)
- **Treasury:** the Ring's public funding wallet is a Privy server wallet — the shield/unshield ramp between public USDC and private notes.
- **Earn:** the idle unshielded buffer earns through **Privy Earn** — Morpho vaults on Base — with live balance and APY in the dashboard, deposit/withdraw working. Private strategies (the position itself a shielded note) sit beside it as roadmap.

**SPEAKER NOTE:** Privy makes "institutional email is enough" literal — auth, the public-side wallet, and real Morpho yield on the treasury buffer, all through one SDK, zero wallet UX.

---

## Slide 5 — World (ProveKit)

# Your salary never leaves your device.

- Payroll runs as a private fan-out: one treasury pool → N per-employee entitlement notes. Colleagues can't see each other's pay; the public sees gray rings.
- The claim is proved **in the browser with ProveKit**: the employee's witness — salary, note secrets — never leaves their device. WHIR proof generated client-side, deliberately consumer-grade UX for the one consumer-shaped user in the system.
- The circuit is pure-Poseidon, backend-portable Noir — the same source proves under ProveKit in the browser and UltraHonk on the settlement path.

**SPEAKER NOTE:** This is client-side proving with a reason to exist — the employee is the only party who should ever hold their salary witness, and ProveKit keeps it that way.
