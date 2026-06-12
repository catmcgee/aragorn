# DECISIONS — resolve-at-build verdicts & deviations

Every resolve-at-build item (BUILD_SPEC §1) gets an entry: what was found, what was chosen, link.

## P0

### D-000: Build-timing track
2026-06-12. ETHGlobal NY scratch track: all code written from session start today; the three
spec documents (PLAN/BUILD_SPEC/EXPLORATION) are design prep, which is allowed.

### D-001: Proving stack — ProveKit verdict → bb/UltraHonk fallback TRIGGERED
2026-06-12. ProveKit's native proof system is Spartan+WHIR (no trusted setup, hash-based) —
NOT Groth16. Groth16 exists only as a gnark recursive wrapper with **no Solidity verifier
export** (open issue worldfnd/provekit#447; zero .sol in repo). On-chain EVM verification is
therefore impossible with ProveKit today. Per BUILD_SPEC §1's pre-specified fallback:
**Barretenberg/UltraHonk is the prover for all 8 settlement circuits** (bb.js server + browser,
`bb write_solidity_verifier` per circuit). **ProveKit retained for World Track D**: in-browser
WHIR proving of `entitlement_claim` + off-chain verification (track rules allow browser/service
verification targets). ProveKit v1 = Noir 1.0.0-beta.11; browser SDK = `@atheonxyz/verity`
0.3.2-alpha (peer deps noir_js/acvm_js beta.11). ProveKit R1CS-lowered blackboxes:
Poseidon2Permutation ✓, MultiScalarMul ✓ (so entitlement_claim's pure-Poseidon design works).

### D-004: Privy Earn — confirmed workable
2026-06-12. Earn = ERC-4626 Morpho vaults (Gauntlet/Steakhouse), **USDC on Base self-serve** —
exactly our target. Server SDK = `@privy-io/node` (NOT @privy-io/server-auth — deprecated).
Deposit: `POST /api/v1/wallets/{id}/earn/ethereum/deposit {vault_id, amount}`; withdraw
analogous; position: `GET .../earn/ethereum/vaults?vault_id=`; APY (bps): `GET
/api/v1/earn/ethereum/vaults/{vault_id}`. Requires dashboard Earn setup (done — vault id in
.env.local). Token verify: `privy.utils().auth().verifyAccessToken()`. Test email mode exists
(dashboard-assigned `test-XXXX@privy.io` + fixed OTP; enable in dashboard → Authentication →
Advanced → test accounts).

### D-005: ENS Sepolia — confirmed; current (struct-based) controller
2026-06-12. Sepolia: Registry 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e, NEW
ETHRegistrarController 0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968 (struct `Registration`
incl. `referrer`; commit→wait 60s→register; ~0.003125 ETH/yr for 5+ chars; registers
UNWRAPPED), PublicResolver 0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5, UniversalResolver
0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe. Subnames: Registry.setSubnodeRecord(node,
labelhash, owner, resolver, 0). viem sepolia: ENS + ENSIP-10 wildcard + CCIP-Read automatic.
CCIP: vendor OffchainResolver.sol from ensdomains/offchain-resolver (pattern still canonical;
docs still describe it); gateway = plain Hono route signing
keccak256(0x1900‖target‖expires‖keccak(request)‖keccak(result)) per SignatureVerifier.

### D-007: No mainnet fork (USER DECISION)
2026-06-12. Settlement = plain local Anvil (31337) + MockUSDC (6 decimals) minted by seed
script. Removes mainnet RPC blocker, whale impersonation, FORK_BLOCK pinning. BUILD_SPEC
amended in-place (header note).

### D-008: bun replaces pnpm (USER DECISION)
2026-06-12. bun 1.2.22 workspaces; turbo retained for task running.

### D-009: biscuit-wasm
2026-06-12. Package = `@biscuit-auth/biscuit-wasm` 0.6.0 (ESM-only, Node ≥22, needs
`--experimental-wasm-modules`; 0.6 API: `new KeyPair(SignatureAlgorithm.Ed25519)`,
`builder.build(priv)`, `token.appendBlock(block...)`, `authorizer` template →
`AuthorizerBuilder.buildAuthenticated(token)`. Keep server-side only (Next/webpack wasm
gotchas documented).

### D-002: Poseidon2 stays (no circom-Poseidon fallback)
2026-06-12. Solidity implementation = vendored zemse/poseidon2-evm **Yul** contract
(BN254 t=4 Rf=8 Rp=56 — Barretenberg's exact params, which ARE the Horizen-generated
reference params; ~31k gas/hash incl. call overhead). Three-way byte-equality fixture
PASSES: noir-lang/poseidon v0.3.0 == bb.js poseidon2Hash == Poseidon2Yul_BN254, vectors
asserted in all three test suites (`make p0`). Note: Noir stdlib poseidon2 is pub(crate) in
beta.21 — the external noir-lang/poseidon lib is mandatory. On-chain usage is arity-2 only
(Merkle internal nodes); commitments/nullifiers computed in-circuit/TS only.

### D-003: Schnorr auth stays (no secret-knowledge fallback) — split-version signing
2026-06-12. bb rewrote Schnorr to Poseidon2+DST on 2026-05-18 (aztec-packages#21808); the
nargo-beta.21-paired bb (5.0.0-nightly.20260324) signs the OLD scheme, while noir-lang/schnorr
v0.4.0 verifies the NEW one. Resolution: the scheme only binds TS-signer ↔ circuit-verifier
(the prover just executes blackboxes), so we sign with `bbsign` = npm alias of
@aztec/bb.js@5.0.0-nightly.20260611 (`schnorrConstructSignature({messageField, privateKey})`
→ (s,e), split into EmbeddedCurveScalar lo/hi 16-byte halves) and prove with the paired March
bb. Full chain proven in `make p0` step 5. entitlement_claim still uses pure secret-knowledge
auth per spec (Poseidon-only, ProveKit-portable).

### D-006: bb/bb.js version pins + in-process proving API
2026-06-12. bb CLI = 5.0.0-nightly.20260324 (bbup-resolved pair for nargo 1.0.0-beta.21);
@aztec/bb.js = 5.0.0-nightly.20260324 for proving (June nightlies REJECT beta.21 ACIR:
"error converting into field Circuit::opcodes"); bbsign alias = 5.0.0-nightly.20260611
signing-only. bb.js 5.x API: `const api = await Barretenberg.initSingleton(); new
UltraHonkBackend(artifact.bytecode, api)` (second ctor arg is the API, NOT options);
`generateProof(gzippedWitness, {keccak: true})`. Fixture circuit proves in ~80ms in-process
under bun. Sync hashing: `BarretenbergSync.initSingleton()` → `api.poseidon2Hash({inputs:
Uint8Array(32)[]})`.

### D-010: No proof wrapping (USER DECISION)
2026-06-12. On-chain verification = bb's native UltraHonk Solidity verifier per circuit
(keccak oracle). No Groth16 wrap of Honk, no recursive wrappers. Direct Groth16 would
require ProveKit's unshipped Solidity export (see D-001) — not available, so native Honk
everywhere. Gas (~1.5–2M/verify) is irrelevant on local Anvil; honest-narration point for
the demo ("Groth16 wrap is production roadmap").

