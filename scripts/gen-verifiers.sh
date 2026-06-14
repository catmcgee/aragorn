#!/usr/bin/env bash
# Regenerates vendored Solidity Honk verifiers (BUILD_SPEC S5). CI diffs the output.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
mkdir -p contracts/src/verifiers

CIRCUITS=${CIRCUITS:-"cash_shield cash_transfer cash_unshield cash_fanout entitlement_claim repo_propose_allocate repo_accept repo_close strategy_open strategy_redeem"}

pascal() { echo "$1" | awk -F_ '{for (i=1;i<=NF;i++) printf "%s%s", toupper(substr($i,1,1)), substr($i,2)}'; }

for c in $CIRCUITS; do
  dir="$ROOT/circuits/$c"
  [ -d "$dir" ] || { echo "skip $c (no crate yet)"; continue; }
  name="$(pascal "$c")Verifier"
  echo "── $c → $name"
  (cd "$dir" && nargo compile --silence-warnings)
  bb write_vk --scheme ultra_honk --oracle_hash keccak -b "$dir/target/$c.json" -o "$dir/target/vk_dir"
  bb write_solidity_verifier --scheme ultra_honk -k "$dir/target/vk_dir/vk" -o "$ROOT/contracts/src/verifiers/$name.sol"
  # unique top-level contract name per circuit (libraries stay file-scoped)
  sed -i.bak "s/contract HonkVerifier is/contract $name is/" "$ROOT/contracts/src/verifiers/$name.sol" && rm -f "$ROOT/contracts/src/verifiers/$name.sol.bak"
done
echo "done."
