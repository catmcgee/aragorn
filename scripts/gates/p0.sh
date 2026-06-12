#!/usr/bin/env bash
# P0 gate (BUILD_SPEC §8, amended): prover pipeline + Poseidon2 three-way equality + Schnorr verdict.
# Green means:
#  1. Noir circuit compiles, bb (UltraHonk/keccak) proves & verifies natively
#  2. bb-generated Solidity verifier verifies the proof in the EVM (forge)
#  3. Poseidon2 byte-equality: Noir == bb.js(TS) == Solidity
#  4. Schnorr: TS-signed (new scheme) signature verifies in-circuit and proves
#  5. bb.js in-process proving works (server/browser path)
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd)

echo "── [1/5] Noir fixture: compile + self-asserting vectors"
cd "$ROOT/spikes/p0-poseidon2/noir_fixture"
nargo test
nargo compile
printf 'x = "7"\n' > Prover.toml
nargo execute witness

echo "── [2/5] bb native prove/verify + Solidity verifier regen"
bb write_vk --scheme ultra_honk --oracle_hash keccak -b target/poseidon2_fixture.json -o target/vk_dir
bb prove --scheme ultra_honk --oracle_hash keccak -b target/poseidon2_fixture.json -w target/witness.gz -k target/vk_dir/vk -o target/proof_dir
bb verify --scheme ultra_honk --oracle_hash keccak -k target/vk_dir/vk -p target/proof_dir/proof -i target/proof_dir/public_inputs
bb write_solidity_verifier --scheme ultra_honk -k target/vk_dir/vk -o target/Verifier.sol
cp target/Verifier.sol "$ROOT/spikes/p0-provekit/onchain/src/Verifier.sol"
xxd -p -c0 target/proof_dir/proof | tr -d '\n' > "$ROOT/spikes/p0-provekit/onchain/test/proof.hex"
xxd -p -c0 target/proof_dir/public_inputs | tr -d '\n' > "$ROOT/spikes/p0-provekit/onchain/test/public_inputs.hex"

echo "── [3/5] EVM verification + Solidity Poseidon2 equality (forge)"
cd "$ROOT/spikes/p0-provekit/onchain"
forge test

echo "── [4/5] bb.js: Poseidon2 TS equality + in-process proving"
cd "$ROOT/spikes/p0-poseidon2"
bun poseidon-equality.ts
bun bbjs-prove.ts

echo "── [5/5] Schnorr: TS sign (new scheme) → in-circuit verify → prove"
cd "$ROOT/spikes/p0-schnorr/circuit"
nargo execute witness
bb write_vk --scheme ultra_honk --oracle_hash keccak -b target/schnorr_spike.json -o target/vk_dir
bb prove --scheme ultra_honk --oracle_hash keccak -b target/schnorr_spike.json -w target/witness.gz -k target/vk_dir/vk -o target/proof_dir
bb verify --scheme ultra_honk --oracle_hash keccak -k target/vk_dir/vk -p target/proof_dir/proof -i target/proof_dir/public_inputs

echo ""
echo "✅ P0 GATE GREEN — prover: bb/UltraHonk (native, no wrap); hash: Poseidon2 (bb params); auth: Schnorr"
