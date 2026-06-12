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
| Next.js | TBD (P3) | latest stable App Router |
| viem | TBD (P1) | latest |
| @privy-io/react-auth / server-auth | TBD (P3) | |
| biscuit-wasm | TBD (P2) | |
| drizzle-orm / postgres | TBD (P2) | Postgres 16 via docker (local psql is 14 — use docker) |
| @noble/curves / @noble/ciphers | TBD (P1) | |

| noir-lang/poseidon | v0.3.0 | Poseidon2 (stdlib version is pub(crate)) |
| noir-lang/schnorr | v0.4.0 | Poseidon2+DST scheme |
| zemse/poseidon2-evm | vendored @ main 2026-06-12 | Yul, bb params (D-002) |
