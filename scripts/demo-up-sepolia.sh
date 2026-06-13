#!/usr/bin/env bash
# Bring up the demo stack against REAL Sepolia (settlement) — contracts deployed live,
# every shield/repo/payroll a real Sepolia tx on Etherscan. Identity (ENS) already on
# Sepolia; Privy Earn already on Base. One funded key (the deployer) acts as deployer +
# relayer + both rings' funding EOA. Needs ~0.3 SepoliaETH on the deployer.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
PIDFILE=/tmp/aragorn-sepolia.pids
set -a; source .env.local 2>/dev/null || true; set +a

: "${SEPOLIA_RPC_URL:?set SEPOLIA_RPC_URL in .env.local}"
: "${SEPOLIA_DEPLOYER_KEY:?set SEPOLIA_DEPLOYER_KEY in .env.local}"
RPC="$SEPOLIA_RPC_URL"
KEY="$SEPOLIA_DEPLOYER_KEY"
ADDR=$(cast wallet address "$KEY")
EXPLORER="https://sepolia.etherscan.io"

echo "── preflight: deployer $ADDR"
BAL=$(cast balance "$ADDR" --rpc-url "$RPC")
BAL_ETH=$(cast from-wei "$BAL")
echo "   balance: $BAL_ETH ETH"
# need ~0.25 ETH for 8 verifier deploys + registry + seeding
python3 -c "import sys; sys.exit(0 if float('$BAL_ETH') >= 0.2 else 1)" || {
  echo "   ⚠️  need ≥ ~0.25 SepoliaETH to deploy + seed. Fund $ADDR and rerun."; exit 1; }

echo "── teardown previous"
[ -f $PIDFILE ] && kill $(cat $PIDFILE) 2>/dev/null || true; rm -f $PIDFILE
pkill -f "experimental-wasm-modules.*apps/ring" 2>/dev/null || true
pkill -f "coordinator/src/index.ts" 2>/dev/null || true
sleep 1

echo "── postgres (fresh ring dbs)"
docker compose -f infra/docker-compose.yml up -d --wait 2>/dev/null
for db in ring_ubs ring_drw; do
  docker exec aragorn-postgres psql -U aragorn -d postgres -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE);"
  docker exec aragorn-postgres psql -U aragorn -d postgres -q -c "CREATE DATABASE $db;"
done

echo "── deploy settlement stack to Sepolia (8 verifiers + registry — a few minutes, ~0.15 ETH)"
RPC_URL="$RPC" DEPLOYER_KEY="$KEY" DEPLOY_OUT="contracts/deployments.sepolia.json" bun scripts/deploy.ts

REGISTRY=$(python3 -c "import json;print(json.load(open('contracts/deployments.sepolia.json'))['registry'])")
VAULT=$(python3 -c "import json;print(json.load(open('contracts/deployments.sepolia.json'))['vault'])")
USDC=$(python3 -c "import json;print(json.load(open('contracts/deployments.sepolia.json'))['usdc'])")
DEPLOY_BLOCK=$(python3 -c "import json;print(json.load(open('contracts/deployments.sepolia.json'))['deployBlock'])")
echo "   registry $REGISTRY @ block $DEPLOY_BLOCK"

echo "── mint demo USDC to the funding EOA ($ADDR)"
cast send "$USDC" "mint(address,uint256)" "$ADDR" 100000000000000 --rpc-url "$RPC" --private-key "$KEY" >/dev/null
echo "   minted \$100M MockUSDC"

# shared Sepolia ring env (one funded key for relayer + funding; chunked, deploy-block start)
COMMON="RPC_URL=$RPC NOTE_REGISTRY_ADDR=$REGISTRY USDC_ADDR=$USDC SHIELD_VAULT_ADDR=$VAULT \
  RELAYER_URL=http://127.0.0.1:4900 SEPOLIA_RPC_URL=$SEPOLIA_RPC_URL \
  PRIVY_APP_ID=${PRIVY_APP_ID:-} PRIVY_APP_SECRET=${PRIVY_APP_SECRET:-} \
  CHAIN=sepolia FUNDING_EOA_PRIVATE_KEY=$KEY SYNC_START_BLOCK=$DEPLOY_BLOCK SYNC_LOG_RANGE=9 EXPLORER_BASE=$EXPLORER"

echo "── coordinator (relayer = deployer, pays Sepolia gas)"
RPC_URL="$RPC" CHAIN=sepolia PORT=4900 RELAYER_PRIVATE_KEY="$KEY" \
  RELAYER_TOKENS='{"ubs-relay-token":"JP Morgan","drw-relay-token":"Goldman Sachs"}' \
  bun apps/coordinator/src/index.ts & echo $! >> $PIDFILE

echo "── rings (JP Morgan :4001, Goldman Sachs :4002) against Sepolia"
eval "RING_ORG_NAME='JP Morgan' PORT=4001 RING_ENS=jpmorgan.aragornrings.eth \
  DATABASE_URL=postgres://aragorn:aragorn@127.0.0.1:5434/ring_ubs \
  RELAYER_TOKEN=ubs-relay-token API_TOKEN=ubs-api-token \
  ORG_ENC_PRIV=0x1111111111111111111111111111111111111111111111111111111111111111 \
  PARTY_KEYS='\''{\"treasury\":\"0x111\",\"trading\":\"0x112\"}'\'' \
  BISCUIT_ROOT_PRIV=ed25519-private/1111111111111111111111111111111111111111111111111111111111111111 \
  GATEWAY_SIGNER_KEY=0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba \
  ENABLED_MODULES=payments,repo,payroll,issuance,strategies \
  $COMMON node --experimental-wasm-modules --experimental-transform-types --no-warnings apps/ring/src/index.ts &" ; echo $! >> $PIDFILE

eval "RING_ORG_NAME='Goldman Sachs' PORT=4002 RING_ENS=goldman.aragornrings.eth \
  DATABASE_URL=postgres://aragorn:aragorn@127.0.0.1:5434/ring_drw \
  RELAYER_TOKEN=drw-relay-token API_TOKEN=drw-api-token \
  ORG_ENC_PRIV=0x2222222222222222222222222222222222222222222222222222222222222222 \
  PARTY_KEYS='\''{\"desk\":\"0x221\"}'\'' \
  BISCUIT_ROOT_PRIV=ed25519-private/2222222222222222222222222222222222222222222222222222222222222222 \
  ENABLED_MODULES=payments,repo,strategies \
  $COMMON node --experimental-wasm-modules --experimental-transform-types --no-warnings apps/ring/src/index.ts &" ; echo $! >> $PIDFILE

for p in 4900 4001 4002; do
  for i in $(seq 1 60); do curl -sf http://127.0.0.1:$p/health >/dev/null 2>&1 && break; sleep 0.5; [ "$i" = 60 ] && { echo "service :$p failed"; exit 1; }; done
done
echo "   services up"

echo "── seed the US Treasury bond (real Sepolia tx)"
RPC_URL="$RPC" DEPLOYER_KEY="$KEY" SEED_REGISTRY="$REGISTRY" \
  DEPLOYMENTS=contracts/deployments.sepolia.json bun scripts/seed-bond.ts

echo "── seed demo state on Sepolia (real proofs + real settles — several minutes)"
bun scripts/seed-demo.ts

echo ""
echo "✅ SEPOLIA STACK UP — settlement live on Sepolia"
echo "   registry $EXPLORER/address/$REGISTRY"
echo "   rings: JP Morgan :4001 · Goldman Sachs :4002 (tunnel these for the hosted site)"
echo "   stop: kill \$(cat $PIDFILE)"
