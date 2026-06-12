#!/usr/bin/env bash
# P1 gate: circuits + contracts + scripted shield→transfer→unshield on local Anvil
# via packages/protocol only.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd)

echo "── circuits: nargo tests"
for c in cash_shield cash_transfer cash_unshield; do
  (cd "circuits/$c" && nargo test --silence-warnings)
done

echo "── protocol: bun tests"
(cd packages/protocol && bun test)

echo "── contracts: forge tests"
(cd contracts && forge test)

echo "── anvil: fresh instance"
pkill -f "anvil --port 8546" 2>/dev/null || true
anvil --port 8546 --disable-code-size-limit --block-time 1 --silent &
ANVIL_PID=$!
trap "kill $ANVIL_PID 2>/dev/null || true" EXIT
sleep 1.5

echo "── deploy"
RPC_URL=$RPC bun scripts/deploy.ts > /dev/null

echo "── round-trip (proving three circuits, ~30s)"
RPC_URL=http://127.0.0.1:8546 bun scripts/p1-roundtrip.ts

echo ""
echo "✅ P1 GATE GREEN"
