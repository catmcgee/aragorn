#!/usr/bin/env bash
# Bring up the full demo stack and LEAVE IT RUNNING: anvil + contracts + postgres +
# coordinator + two Rings + dashboard, then seed per BUILD_SPEC §10.
# `make demo-reset` = kill + rerun this.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
RPC=http://127.0.0.1:8546
PIDFILE=/tmp/aragorn-demo.pids

set -a; source .env.local 2>/dev/null || true; set +a

echo "── tearing down any previous demo stack"
[ -f $PIDFILE ] && kill $(cat $PIDFILE) 2>/dev/null || true
rm -f $PIDFILE
pkill -f "anvil --port 8546" 2>/dev/null || true
pkill -f "experimental-wasm-modules.*apps/ring" 2>/dev/null || true
pkill -f "coordinator/src/index.ts" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 1

echo "── postgres"
docker compose -f infra/docker-compose.yml up -d --wait 2>/dev/null
for db in ring_ubs ring_drw; do
  docker exec aragorn-postgres psql -U aragorn -d postgres -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE);"
  docker exec aragorn-postgres psql -U aragorn -d postgres -q -c "CREATE DATABASE $db;"
done

echo "── anvil + contracts"
anvil --port 8546 --disable-code-size-limit --block-time 1 --silent &
echo $! >> $PIDFILE
sleep 1.5
(cd contracts && forge script script/Deploy.s.sol --rpc-url $RPC \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast --code-size-limit 1000000 > /dev/null)

REGISTRY=$(python3 -c "import json; print(json.load(open('contracts/deployments.local.json'))['registry'])")
VAULT=$(python3 -c "import json; print(json.load(open('contracts/deployments.local.json'))['vault'])")
USDC=$(python3 -c "import json; print(json.load(open('contracts/deployments.local.json'))['usdc'])")

UBS_FUND_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
DRW_FUND_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
# $25M mock USDC to each funding EOA (BUILD_SPEC §10: $20M+; extra for payroll/demo headroom)
cast send $USDC "mint(address,uint256)" $(cast wallet address $UBS_FUND_KEY) 25000000000000 --rpc-url $RPC \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 -q
cast send $USDC "mint(address,uint256)" $(cast wallet address $DRW_FUND_KEY) 25000000000000 --rpc-url $RPC \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 -q

echo "── seed the Goldman bond"
RPC_URL=$RPC bun scripts/seed-bond.ts

echo "── coordinator + rings + dashboard"
RPC_URL=$RPC PORT=4900 bun apps/coordinator/src/index.ts & echo $! >> $PIDFILE

RING_ORG_NAME=UBS PORT=4001 RING_ENS=ubs.aragornrings.eth \
  DATABASE_URL=postgres://aragorn:aragorn@127.0.0.1:5434/ring_ubs \
  RPC_URL=$RPC NOTE_REGISTRY_ADDR=$REGISTRY USDC_ADDR=$USDC SHIELD_VAULT_ADDR=$VAULT \
  RELAYER_URL=http://127.0.0.1:4900 RELAYER_TOKEN=ubs-relay-token API_TOKEN=ubs-api-token \
  ORG_ENC_PRIV=0x1111111111111111111111111111111111111111111111111111111111111111 \
  PARTY_KEYS='{"treasury":"0x111","trading":"0x112"}' \
  FUNDING_EOA_PRIVATE_KEY=$UBS_FUND_KEY \
  BISCUIT_ROOT_PRIV="ed25519-private/1111111111111111111111111111111111111111111111111111111111111111" \
  GATEWAY_SIGNER_KEY=0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba \
  EMAIL_DOMAIN_ALLOWLIST="ubs-demo.com,privy.io" \
  ENABLED_MODULES="payments,repo,payroll,issuance,strategies" \
  SEPOLIA_RPC_URL="$SEPOLIA_RPC_URL" PRIVY_APP_ID="${PRIVY_APP_ID:-}" PRIVY_APP_SECRET="${PRIVY_APP_SECRET:-}" \
  PRIVY_EARN_WALLET_ID="${PRIVY_EARN_WALLET_ID:-}" PRIVY_EARN_VAULT_ID="${PRIVY_EARN_VAULT_ID:-}" \
  node --experimental-wasm-modules --experimental-transform-types --no-warnings apps/ring/src/index.ts & echo $! >> $PIDFILE

RING_ORG_NAME=DRW PORT=4002 RING_ENS=drw.aragornrings.eth \
  DATABASE_URL=postgres://aragorn:aragorn@127.0.0.1:5434/ring_drw \
  RPC_URL=$RPC NOTE_REGISTRY_ADDR=$REGISTRY USDC_ADDR=$USDC SHIELD_VAULT_ADDR=$VAULT \
  RELAYER_URL=http://127.0.0.1:4900 RELAYER_TOKEN=drw-relay-token API_TOKEN=drw-api-token \
  ORG_ENC_PRIV=0x2222222222222222222222222222222222222222222222222222222222222222 \
  PARTY_KEYS='{"desk":"0x221"}' \
  FUNDING_EOA_PRIVATE_KEY=$DRW_FUND_KEY \
  BISCUIT_ROOT_PRIV="ed25519-private/2222222222222222222222222222222222222222222222222222222222222222" \
  EMAIL_DOMAIN_ALLOWLIST="drw-demo.com,privy.io" \
  ENABLED_MODULES="payments,repo,strategies" \
  SEPOLIA_RPC_URL="$SEPOLIA_RPC_URL" PRIVY_APP_ID="${PRIVY_APP_ID:-}" PRIVY_APP_SECRET="${PRIVY_APP_SECRET:-}" \
  node --experimental-wasm-modules --experimental-transform-types --no-warnings apps/ring/src/index.ts & echo $! >> $PIDFILE

(cd apps/dashboard && NEXT_PUBLIC_PRIVY_APP_ID="${PRIVY_APP_ID:-}" bun run dev > /tmp/aragorn-dashboard.log 2>&1) & echo $! >> $PIDFILE

for port in 4900 4001 4002 3000; do
  for i in $(seq 1 90); do
    curl -sf http://127.0.0.1:$port > /dev/null 2>&1 || curl -sf http://127.0.0.1:$port/health > /dev/null 2>&1 && break
    sleep 1
    [ "$i" = 90 ] && { echo "service :$port failed"; exit 1; }
  done
done
echo "── all services up; seeding demo state (proofs — takes a couple of minutes)"
bun scripts/seed-demo.ts

echo ""
echo "✅ DEMO STACK UP"
echo "   dashboard  http://localhost:3000   (UBS ring :4001, DRW ring :4002)"
echo "   anvil      $RPC   registry $REGISTRY"
echo "   stop: kill \$(cat $PIDFILE)"
