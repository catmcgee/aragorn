# VERSIONS — pinned toolchain (P0)

Recorded at build start, 2026-06-12. Update only with a DECISIONS.md entry.

| Tool | Version | Notes |
|---|---|---|
| Noir (nargo) | 1.0.0-beta.21 | paired with bb 5.0.0-nightly.20260324 (bbup -nv) |
| Barretenberg (bb CLI) | 5.0.0-nightly.20260324 | fallback prover |
| @aztec/bb.js | 5.0.0-nightly.20260324 (prove) + alias `bbsign`=5.0.0-nightly.20260611 (sign) | D-003/D-006 |
| ProveKit | not used for settlement (D-001); booth demo only (P5) | WHIR-native, no EVM verify |
| Foundry (forge/anvil) | 1.6.0-v1.7.0 | |
| Node | 25.9.0 | spec said 22 LTS; 25 present and fine |
| bun | 1.2.22 | replaces pnpm (user decision, D-008) |
| turborepo | ^2.5.0 | |
| Next.js | 16.2.9 (Turbopack) | App Router |
| viem | 2.52.2 | |
| @privy-io/react-auth / @privy-io/node | 3.29.2 / 0.21.x | server-auth deprecated; JWKS verify for test tokens |
| @biscuit-auth/biscuit-wasm | 0.6.0 | rings run on Node (wasm-modules); bun incompatible |
| postgres (porsager) | 3.x | raw SQL, no ORM (hackathon cut); Postgres 16 via docker :5434 |
| @noble/curves / @noble/ciphers | TBD (P1) | |

| noir-lang/poseidon | v0.3.0 | Poseidon2 (stdlib version is pub(crate)) |
| noir-lang/schnorr | v0.4.0 | Poseidon2+DST scheme |
| zemse/poseidon2-evm | vendored @ main 2026-06-12 | Yul, bb params (D-002) |
