# ENS v2 as Core Architecture for Aragorn

Date: 2026-06-13. Author: research pass over ENS v2 docs
(`feature-ensv2-docs.docs-bao.pages.dev/contracts/ensv2/*`) + Aragorn's current ENS wiring.

Thesis the user wants to defend: **ENS v2 should be load-bearing infrastructure for Aragorn — not
cosmetic naming.** Aragorn already treats "a resolvable Aragorn name with the right records" as the
identity/discovery layer (`apps/ring/src/ens.ts`, `apps/ring/src/flows.ts:76`). The question is
whether v2's primitives let us move that identity *on-chain, ownable, and permissioned* — and
retire the offchain pieces we only built because v1 forced us to.

---

## A. ENS v2 mechanics that matter for us (doc-grounded)

### A1. Hierarchical per-name registries (registry-hierarchy)
v2 replaces v1's single flat registry with a **tree of registries**: "each name can have its own
registry for managing subnames." A name like `inigo.montoya.eth` is "a chain of entries across
registries," reconstructed by walking the tree. Each registry implements a minimal `IRegistry`:
`getSubregistry(label)`, `getResolver(label)`, `getParent()`.

Concretely for us: **an owner can deploy their own registry contract and attach it as the
subregistry for their name** (`setSubregistry(anyId, registry)`, gated by `ROLE_SET_SUBREGISTRY`).
From that point *they* mint/burn the subnames under their name on-chain. Resolution walks down and
**the deepest resolver wins (longest-suffix match)** — so a 2LD resolver can answer for descendants
*unless* a deeper node sets its own. This is the on-chain analogue of the ENSIP-10 wildcard we lean
on today.

### A2. Permissioned Registry — subnames as real, role-bearing ERC-1155 tokens (permissioned-registry)
The standard `IRegistry` implementation tokenizes every name as an **ERC-1155 *singleton*** (exactly
one owner). `register(label, owner, registry, resolver, roleBitmap, expiry)` is the issuance call;
the caller needs `ROLE_REGISTRAR` on the parent. 10 roles, each with an admin variant (`role << 128`):
`ROLE_REGISTRAR`, `ROLE_REGISTER_RESERVED`, `ROLE_SET_PARENT`, `ROLE_UNREGISTER`, `ROLE_RENEW`,
`ROLE_SET_SUBREGISTRY`, `ROLE_SET_RESOLVER`, `ROLE_CAN_TRANSFER_ADMIN`, `ROLE_SET_URI`, `ROLE_UPGRADE`.

Two properties matter for an institutional product:
- **Version isolation / mutable token IDs**: re-registering an expired name burns the old token and
  bumps `eacVersionId` + `tokenVersionId`, so **stale permissions never carry over** and pending
  marketplace approvals are invalidated when roles change. For a settlement network this is exactly
  the "revoking access actually revokes it, atomically" guarantee you want.
- **`owner = address(0)` reserves** a label without granting ownership — useful for pre-allocating
  an institution's name before it onboards.

### A3. Enhanced Access Control (EAC) — role bitmaps as governance primitive (enhanced-access-control)
EAC is the v2 permission engine. Up to **2^256 resources, 64 roles/resource (32 regular + 32 admin),
15 holders per role**. A *resource* is a name (labelhash in registries; namehash + record-type in
resolvers). `ROOT_RESOURCE (0x0)` is a master key: a role there applies to every resource in the
contract. Roles are packed in a `uint256` (bits 0–127 regular, 128–255 admin; one nybble each).
Granting needs the matching admin role; `grantRoles`/`revokeRoles` (per-resource) and
`grantRootRoles`/`revokeRootRoles` (contract-wide). Crucially **reversible** (unlike v1 fuses) and
**delegable to up to 15 accounts** per role per resource.

This is the key insight: **EAC is a general-purpose, on-chain, per-name RBAC system.** Aragorn
already has an RBAC model (`apps/ring/src/auth.ts:17`: `admin | trader | approver | viewer | auditor
| employee`) but it lives in Postgres and is enforced only inside one Ring's API. EAC is the
on-chain shape of the same idea.

### A4. Permissioned Resolver — per-owner proxy, per-record permissions (permissioned-resolver)
In v2 "each account gets its own resolver instance, deployed as a UUPS proxy" via the Verifiable
Factory; **the deployer is granted every role + admin on `ROOT_RESOURCE` by default.** Records are
permissioned at three scopes: root (all records), name (all keys on a name), record
(single text key / coin type / data key). 11 roles, 8 of them per-record-type: `ROLE_SET_ADDR`,
`ROLE_SET_TEXT`, `ROLE_SET_CONTENTHASH`, `ROLE_SET_PUBKEY`, `ROLE_SET_ABI`, `ROLE_SET_INTERFACE`,
`ROLE_SET_NAME`, `ROLE_SET_ALIAS`, `ROLE_CLEAR`, `ROLE_SET_DATA`, `ROLE_UPGRADE`.

We already use exactly this contract on Sepolia today (D-012): our resolver proxy
`0xC909a297…` was deployed through the `VerifiableFactory` with a `ROLE_SET_ADDR | ROLE_SET_TEXT`
(+admin) bitmap (`scripts/ens-v2-setup.ts:51`, `:269`). So A4 is not theoretical for us — it is the
canonical demo path. What we have *not* yet exploited is **record-level delegation**: e.g. letting a
department's key-rotation service hold `ROLE_SET_TEXT` for only `aragorn.partykey` on its own node.

### A5. Mutable token IDs / ERC-1155 singleton (mutable-token-ids, erc1155-singleton)
"anyId polymorphism": functions accept labelhash, token ID, or resource interchangeably. Ownership
is single-owner ERC-1155. The token ID regenerates on role change — so **a name's NFT is a live
handle whose validity tracks its permissions**, not a static collectible. For Aragorn this means an
institution's name *is* a transferable, role-bearing asset (custody handoff, M&A, key compromise
recovery) with on-chain finality.

### A6. L1 vs Namechain (migration, universal-resolver-v2) — what the docs DO and DON'T say
The docs in this build are explicit that "contracts and interfaces are **not yet final**." They
describe migration (v1 names batch-**reserved** in v2 via `BatchRegistrar` with `RESERVED` status,
then owners move tokens to `UnlockedMigrationController` / `LockedMigrationController`) and say
`resolve()/reverse()` and **"all CCIP-Read infrastructure work identically across both versions."**
They are **silent in these pages on Namechain specifics** — they do not state whether the registry
sits on L1 or an L2. Publicly, ENS's v2 design puts the registry/registrar on **Namechain (an L2)**
with L1 resolution proven back via CCIP-Read + storage proofs; treat that as the likely production
topology but **not confirmed by these docs**, so any plan must not hard-depend on a specific chain
id. (Verify against the namechain pages before committing.)

**Implication for the "everything on Ethereum" thesis:** see proposal idea #4 — Namechain is a
nuance, not a contradiction, *if* settlement stays on L1 and only the name layer is L2-with-L1-proof.

---

## B. What Aragorn uses today (file-grounded)

Aragorn ran a deliberate **dual-path** experiment on Sepolia (DECISIONS.md D-012):

**Path 1 — premigration v1 name `aragorn-rings.eth`** (`scripts/ens-setup.ts`)
- Registered via the testnet premigration controller `0xdf60C561…` (free, no commit-reveal;
  `ens-setup.ts:33`). Org subnames `ubs` / `drw` created with
  `Registry.setSubnodeRecord(...)` (`ens-setup.ts:163`) on the **classic** PublicResolver
  `0xE996…` (the modern resolver rejects `setText` for registry-owned subnodes —
  `ens-setup.ts:36-37`).
- Records written (`ens-setup.ts:135-146, 186-209`): `aragorn.encpubkey`, `aragorn.endpoint`,
  `aragorn.partyroot` per org node.

**Path 2 — fully v2-native name `aragornrings.eth` (CANONICAL for the demo)** (`scripts/ens-v2-setup.ts`)
- Registered via the real v2 `ETHRegistrar` `0x8c2E866B…` (commit-reveal, paid in free-mint
  `MockERC20`; `ens-v2-setup.ts:151-257`).
- Resolver = an **owner-deployed `PermissionedResolver` proxy** via `VerifiableFactory`
  (`ens-v2-setup.ts:260-313`), pointed at the 2LD with `setResolver` (`:316-333`).
- Records stored **per-node on that one resolver**, resolved via v2 deepest-resolver-wins wildcard
  and verified end-to-end through `UniversalResolverV2` with `getEnsText` (`:377-397`).

**Org / department metadata model** (`scripts/ens-v2-metadata.ts`, D-014)
- Org node: `aragorn.modules` (capability list, e.g. `payments,repo,payroll,issuance,strategies`),
  `aragorn.auditorkey` (disclosure key), plus `encpubkey/endpoint/partyroot`.
- Department node (e.g. `treasury.ubs.aragornrings.eth`): `aragorn.partykey` (settlement pubkey x),
  `aragorn.desk` (human label) — `ens-v2-metadata.ts:50-65`.

**Employee subnames via CCIP-Read** (`apps/ring/src/gateway.ts`, `scripts/ens-ccip-resolver.ts`,
`contracts/src/ens/OffchainResolver.sol`, D-014)
- The vendored `OffchainResolver` is set as resolver for `ubs.aragorn-rings.eth` (the **v1
  premigration** name; `ens-ccip-resolver.ts:20,47-57`). ENSIP-10 wildcard routes
  `*.ubs.aragorn-rings.eth` to the Ring's signing gateway.
- Gateway (`gateway.ts:46-95`) reads the `employees` table by `subname_label`, answers `text`/`addr`,
  and **signs** `keccak256(0x1900 ‖ target ‖ expires ‖ keccak(request) ‖ keccak(result))`. The
  on-chain resolver pins the signer (`OffchainResolver.sol:61-67`) so a hosted gateway can't forge.
- Employee subnames are **capabilities, not a directory** (`gateway.ts:4`) — they are not
  enumerable on-chain.

**How identity is consumed by the product**
- `EnsDirectory.resolve()` (`ens.ts:29`) reads `aragorn.encpubkey/endpoint/partyroot/modules` via
  viem `getEnsText` (works for v1 + v2 entries). `whitelist()` (`ens.ts:44`) persists the resolution
  into Postgres `ens_whitelist`; transfers go through `lookupWhitelisted()` (`ens.ts:60`) — so
  **whitelisting = resolving a name + caching its records**.
- `resolveRecipient()` (`flows.ts:76`) routes a `.eth` spec: 4+-label names →
  `resolveDepartment()` (party key read live from ENS, `ens.ts:79`); 2-/3-label names →
  whitelisted org (party = `partyroot`). Repo flow reverse-maps `partyroot → encpubkey` from the
  same whitelist (`repo.ts:503`).
- App-internal RBAC (`auth.ts:17`): `admin | trader | approver | viewer | auditor | employee`,
  enforced by `requireRole()` (`api.ts:93`) — entirely off-chain, per-Ring.

**Net:** a counterparty *already is* "a resolvable name with the right records." But the records sit
on a shared resolver, the membership cache lives in Postgres, employee names depend on a
signed-offchain gateway, and the institution's RBAC is invisible on-chain. v2 lets us tighten all
four.

---

## C. Proposal — making ENS v2 core (ranked)

Each idea names the v2 primitive, what it replaces, effort, and risk. Ranked by
*leverage-per-effort* for an institutional settlement product.

### #1 — Each Ring OWNS its name's subregistry; departments/employees are on-chain subname tokens
**v2 primitive:** per-name registries (A1) + Permissioned Registry `register()` (A2). On onboarding,
the coordinator deploys a `PermissionedRegistry` for the institution and attaches it via
`setSubregistry(node, ringRegistry)` (the registrant already holds `ROLE_SET_SUBREGISTRY` from
`ETHRegistrar`'s hardcoded `REGISTRATION_ROLE_BITMAP`). The Ring then mints
`treasury.<inst>.aragornrings.eth`, `cat.<inst>…`, etc. as ERC-1155 subname tokens it controls,
each with its own resolver/records.

**What it replaces:** the offchain CCIP-Read gateway for employees (`gateway.ts`,
`OffchainResolver.sol`) **and** the `setSubnodeRecord`-on-classic-resolver hack for orgs
(`ens-setup.ts:163`). Employees/departments become first-class on-chain entities the institution
mints and revokes itself.

**Does v2 make the offchain gateway unnecessary?** *For the parts we want public/auditable, yes.*
The gateway exists today only because (a) v1 subname issuance is clumsy and (b) we wanted employees
to be non-enumerable capabilities. v2's per-name registry gives the institution cheap, sovereign,
on-chain subname issuance — so **departments and any employee identity we're willing to publish move
on-chain**. Keep CCIP-Read *only* for records that must stay private/high-cardinality (e.g. an
internal employee directory you deliberately don't want enumerable) — now as a *choice*, not a
workaround. This directly strengthens the "a counterparty is a resolvable name" mechanism: the
subname's *existence and ownership* become the on-chain membership proof, not a Postgres row.

**Effort:** Medium. New onboarding step (deploy registry + `setSubregistry`); a thin
`PermissionedRegistry` deploy in `ring-provision`/coordinator; adapt `EnsDirectory` to read the
deeper nodes (it already resolves descendants). Reuse the existing v2 setup scripts as the template.
**Risk:** Medium. Per-Ring registry contract is new surface; testnet contracts "not yet final" (A6);
gas/issuance cost per employee. Mitigate by keeping records on the resolver (cheap `setText`) and
only minting *department* tokens initially.

### #2 — Institutional governance as EAC roles on the institution's name
**v2 primitive:** EAC role bitmaps (A3) on the Ring's registry + resolver resources. Map Aragorn's
RBAC (`auth.ts:17`) onto on-chain roles scoped to the institution's name:
- `admin` → admin-roles on the Ring registry resource (can grant/revoke department/employee roles,
  set resolver/subregistry).
- `trader` / `approver` → resolver record-roles: e.g. only `approver`-held keys may write the
  records that authorize a settlement, dual-control encoded as *two* holders of an admin role
  (EAC allows up to 15 holders → real n-of-m delegation).
- `auditor` → a read-scoped role / holder of the node that carries `aragorn.auditorkey`.

**What it replaces / augments:** moves the *source of truth* for "who at this institution may do
what" from Postgres (`requireRole`, `api.ts:93`) onto the name itself, so counterparties and
auditors can verify an institution's control structure **without trusting that institution's API**.
The Ring's API still enforces day-to-day RBAC, but it *derives* authority from on-chain EAC grants.

**KYB / counterparty whitelisting as roles+records:** instead of (or alongside) the Postgres
`ens_whitelist`, "is X an approved counterparty of mine" can be expressed as **a role X holds on my
Ring's `counterparties` resource**, granted/revoked on-chain (reversible, A3). Reads replace the
cache; writes are auditable. This is a strict upgrade to today's `whitelist()` → DB-row model
(`ens.ts:44`).

**Effort:** Medium-High. Requires designing the role schema and a verification path in `EnsDirectory`
/ `flows`. **Risk:** Medium. EAC semantics are subtle (resource derivation, ROOT master-key blast
radius, version bumps invalidating grants on re-register — A2/A5); needs careful test vectors. Don't
put settlement-blocking logic on testnet EAC until contracts finalize (A6).

### #3 — Onboarding a Ring = registering a name; resolver records are the source of truth
**v2 primitive:** Permissioned Resolver per-owner proxy (A4) + Registrar (A2). Make
`aragorn.partyroot`, `aragorn.encpubkey`, `aragorn.endpoint`, `aragorn.modules`, `aragorn.auditorkey`
the **canonical** config — the Ring boots by *reading its own name*, and there is no separate config
file for these. The provisioning flow becomes: register name → deploy resolver proxy → write records
→ Ring reads them on start.

**What it replaces:** the duplication between the static directory in config
(`flows.ts:101`, `cfg.directory`) and ENS. Today ENS is a *mirror*; this makes ENS *primary* and the
local directory a fallback/cache. Aligns with the existing direction — `ens-v2-metadata.ts` already
treats the resolver as "the metadata model."

**Effort:** Low-Medium. Mostly wiring: have `index.ts`/config loader resolve the Ring's own name at
boot; we already write all these records. **Risk:** Low-Medium. Adds an ENS read to the boot path
(needs a cache + graceful degradation if RPC is down — `EnsDirectory` already guards on
`sepoliaRpcUrl`). This is the safest "deepen" and pairs naturally with #1.

### #4 — Decide the Namechain (L2) posture explicitly, and keep settlement on L1
**v2 primitive:** v2's CCIP-Read-uniform resolution (A6) — `resolve()/reverse()` "work identically
across both versions," and the universal resolver traverses the tree regardless of where a registry
lives. ENS's production design likely settles the *name layer* on Namechain (L2) with L1 proofs.

**Evaluation (does it conflict with "everything on Ethereum"?):** **No, if scoped correctly.**
Aragorn's load-bearing assets — USDC settlement, ZK verifiers, the ledger — stay on L1 Ethereum
(per D-007/D-010 the settlement chain is deliberate). ENS is the *identity/directory* layer, not the
settlement layer. Putting identity on an ENS L2 that is **provable back to L1 via CCIP-Read** keeps
the property that matters ("identity is verifiable from Ethereum") while getting cheap subname
issuance for #1 (minting an employee per hire is painful at L1 gas). The thesis to state to
stakeholders: *"settlement is on Ethereum L1; identity is anchored to Ethereum via ENS, with
issuance economics handled on ENS's L2 and verified through L1 CCIP-Read."* That is *more* defensible
than forcing everything onto L1 and is **exactly the model our existing CCIP-Read code already
speaks** (`OffchainResolver.sol`, `gateway.ts`).

**Effort:** Low to decide/document; Medium if/when we actually target Namechain. **Risk:** Low now
(it's a posture + doc), Medium later (these docs don't pin Namechain — A6; verify before building).
**Action:** read the namechain pages and write a one-paragraph posture into DECISIONS.md so the L2
question stops being ambiguous.

### #5 — vLEI / KYB credentials as records or attestations on the name
**v2 primitive:** resolver text/data records (A4) — `ROLE_SET_DATA` / `ROLE_SET_TEXT` scoped
per-record. Carry institutional KYB on the name: `aragorn.vlei` (GLEIF vLEI credential reference or
hash), `aragorn.lei`, `aragorn.kyb` (attestation pointer/CID). For tamper-resistance, store the
*hash/attestation* on-chain and the credential off-chain, or reference an EAS attestation UID.

**What it makes possible:** counterparty acceptance gains a compliance gate that lives **with the
identity**: `EnsDirectory.resolve()` (`ens.ts:29`) already reads `aragorn.*` text — add `aragorn.lei`/
`aragorn.vlei` to the resolve set and require it before whitelisting. Because record-writes are
EAC-permissioned, only a holder of the KYB-issuer role (idea #2) can set them — so "who attested this
LEI" is itself on-chain.

**Effort:** Low (just more records + a resolve-and-check). Higher if you wire real vLEI verification.
**Risk:** Low technically; the real work is the credential format/issuer trust model, which is a
product decision, not an ENS one. Strong demo value, low blast radius.

### Ranking rationale
#1 and #3 are the structural core (sovereign on-chain identity; name-as-config) and reinforce each
other. #2 is the highest-ceiling idea (on-chain institutional governance) but the riskiest to make
settlement-blocking. #4 is cheap and removes a strategic ambiguity. #5 is a high-value, low-risk
add-on that makes the identity layer compliance-aware.

---

## D. Recommended near-term, demoable step

**Ship #3 + the first half of #1 on the existing v2-native name, as one onboarding flow:**

> **"Onboard a Ring = register its name + deploy its own subregistry, and the Ring boots by reading
> its own ENS records."**

Concretely, extending what already works (`ens-v2-setup.ts`, `ens-v2-metadata.ts`):
1. In provisioning, after registering `<inst>.aragornrings.eth` (or a 2LD), deploy a
   `PermissionedRegistry` and `setSubregistry()` it under the institution's node — the registrant
   already has `ROLE_SET_SUBREGISTRY` (A2/ETHRegistrar bitmap).
2. Mint **department subname tokens** (`treasury.<inst>…`, `trading.<inst>…`) on that registry,
   each with `aragorn.partykey` on the institution's resolver (records already in
   `ens-v2-metadata.ts:50-65`).
3. Change the Ring boot path so `EnsDirectory` resolves **its own** `aragorn.partyroot / encpubkey /
   endpoint / modules` at startup (records exist; `ens.ts:29` already reads them) — ENS becomes the
   source of truth, config is the fallback.
4. Demo script: spin up a fresh institution → it registers a name → mints two department tokens →
   another Ring whitelists it purely by resolving the name → a transfer to
   `treasury.<inst>.aragornrings.eth` settles, with the party key read **live from the on-chain
   subname** (`flows.ts:82` path). Narrate: *"no addresses anywhere; the counterparty is a name the
   institution provably owns and controls on-chain."*

This is demoable on Sepolia v2 today, reuses every contract already verified in D-012/D-014, removes
the most awkward v1 hack (offchain gateway for what should be public departments), and sets up #2/#5
as the next layer. It's the smallest change that makes ENS v2 visibly *load-bearing* rather than
decorative.

---

### Caveats / verify-before-build
- These docs explicitly mark contracts "not yet final" (A6). Pin addresses per D-012 and re-verify.
- The build's pages don't detail Namechain; idea #4's L2 specifics need the namechain pages before
  any L2 targeting.
- The Permissioned Resolver page didn't document wildcard/descendant resolution — but our own D-012
  verification (`ens-v2-setup.ts:377-397`) confirms the 2LD resolver answers for descendants via
  URv2, which is the behavior idea #1/#3 rely on.
