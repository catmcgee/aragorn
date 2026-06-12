#!/usr/bin/env bash
# P2 gate: two Ring processes + relayer; X1 payment UBS→DRW via API (curl);
# sync engines converge; resync --from-zero rebuilds the projection.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
RPC=http://127.0.0.1:8546

cleanup() {
  kill $(jobs -p) 2>/dev/null || true
}
trap cleanup EXIT

echo "── postgres: clean ring databases"
docker compose -f infra/docker-compose.yml up -d --wait 2>/dev/null
for db in ring_ubs ring_drw; do
  docker exec aragorn-postgres psql -U aragorn -d postgres -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE);"
  docker exec aragorn-postgres psql -U aragorn -d postgres -q -c "CREATE DATABASE $db;"
done

echo "── anvil + deploy"
pkill -f "anvil --port 8546" 2>/dev/null || true
sleep 0.5
anvil --port 8546 --disable-code-size-limit --block-time 1 --silent &
sleep 1.5
RPC_URL=$RPC bun scripts/deploy.ts > /dev/null

REGISTRY=$(python3 -c "import json; print(json.load(open('contracts/deployments.local.json'))['registry'])")
VAULT=$(python3 -c "import json; print(json.load(open('contracts/deployments.local.json'))['vault'])")
USDC=$(python3 -c "import json; print(json.load(open('contracts/deployments.local.json'))['usdc'])")
echo "   registry=$REGISTRY"

# fund the two funding EOAs with mock USDC (public-plane prerequisite, not a ring concern)
# anvil[2] = UBS funding, anvil[3] = DRW funding
UBS_FUND_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
DRW_FUND_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
UBS_FUND_ADDR=$(cast wallet address $UBS_FUND_KEY)
DRW_FUND_ADDR=$(cast wallet address $DRW_FUND_KEY)
cast send $USDC "mint(address,uint256)" $UBS_FUND_ADDR 100000000 --rpc-url $RPC \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 -q
cast send $USDC "mint(address,uint256)" $DRW_FUND_ADDR 100000000 --rpc-url $RPC \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 -q

DIRECTORY='{
  "UBS": {"encPubkey": "0x7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13",
           "parties": {"treasury": "0x17e0796c17481a34e6aa53421dce80dd2e7b2a1d49a48e49880faa8e7dcc97a4",
                       "trading": "0x2e72bde3d5a518a1945bf2dc7630464974201f6bddd9f7a3d465cb46be3f003e"}},
  "DRW": {"encPubkey": "0x0faa684ed28867b97f4a6a2dee5df8ce974e76b7018e3f22a1c4cf2678570f20",
           "parties": {"desk": "0x0e6888df5c6acfaea4c9e2d31ffd717268abc22f9cba99efe0300295b3ae6e3a"}}
}'

echo "── coordinator + rings"
RPC_URL=$RPC PORT=4900 bun apps/coordinator/src/index.ts &

RING_ORG_NAME=UBS PORT=4001 \
  DATABASE_URL=postgres://aragorn:aragorn@127.0.0.1:5434/ring_ubs \
  RPC_URL=$RPC NOTE_REGISTRY_ADDR=$REGISTRY USDC_ADDR=$USDC SHIELD_VAULT_ADDR=$VAULT \
  RELAYER_URL=http://127.0.0.1:4900 RELAYER_TOKEN=ubs-relay-token API_TOKEN=ubs-api-token \
  ORG_ENC_PRIV=0x1111111111111111111111111111111111111111111111111111111111111111 \
  PARTY_KEYS='{"treasury":"0x111","trading":"0x112"}' \
  FUNDING_EOA_PRIVATE_KEY=$UBS_FUND_KEY \
  DIRECTORY="$DIRECTORY" \
  node --experimental-wasm-modules --experimental-transform-types --no-warnings apps/ring/src/index.ts &

RING_ORG_NAME=DRW PORT=4002 \
  DATABASE_URL=postgres://aragorn:aragorn@127.0.0.1:5434/ring_drw \
  RPC_URL=$RPC NOTE_REGISTRY_ADDR=$REGISTRY USDC_ADDR=$USDC SHIELD_VAULT_ADDR=$VAULT \
  RELAYER_URL=http://127.0.0.1:4900 RELAYER_TOKEN=drw-relay-token API_TOKEN=drw-api-token \
  ORG_ENC_PRIV=0x2222222222222222222222222222222222222222222222222222222222222222 \
  PARTY_KEYS='{"desk":"0x221"}' \
  FUNDING_EOA_PRIVATE_KEY=$DRW_FUND_KEY \
  DIRECTORY="$DIRECTORY" \
  node --experimental-wasm-modules --experimental-transform-types --no-warnings apps/ring/src/index.ts &

for port in 4900 4001 4002; do
  for i in $(seq 1 40); do
    curl -sf http://127.0.0.1:$port/health > /dev/null && break
    sleep 0.5
    [ "$i" = 40 ] && { echo "service on :$port failed to start"; exit 1; }
  done
done
echo "   all services up"

UBS="-H 'authorization: Bearer ubs-api-token' -s http://127.0.0.1:4001/v1"
DRW="-H 'authorization: Bearer drw-api-token' -s http://127.0.0.1:4002/v1"

jqget() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }

echo "── UBS shields 50 USDC into treasury (proving…)"
eval curl -X POST $UBS/shield -H "'content-type: application/json'" \
  -d "'{\"party\":\"treasury\",\"amountMicro\":\"50000000\"}'" | jqget "['cid']"

echo "── X1: UBS::treasury → DRW::desk 12 USDC via API (proving…)"
eval curl -X POST $UBS/transfers -H "'content-type: application/json'" \
  -d "'{\"fromParty\":\"treasury\",\"toPartyOrEns\":\"DRW::desk\",\"amountMicro\":\"12000000\"}'" | jqget "['txid']"

sleep 3  # let DRW's poll pick it up

echo "── convergence: both portfolios reflect the payment"
UBS_BAL=$(eval curl $UBS/portfolio | jqget "['balances']['treasury']")
DRW_BAL=$(eval curl $DRW/portfolio | jqget "['balances']['desk']")
echo "   UBS treasury = $UBS_BAL (want 38000000), DRW desk = $DRW_BAL (want 12000000)"
[ "$UBS_BAL" = "38000000" ] && [ "$DRW_BAL" = "12000000" ] || { echo "MISMATCH"; exit 1; }

echo "── internal transfer: UBS treasury → trading 5 USDC (proving…)"
eval curl -X POST $UBS/transfers -H "'content-type: application/json'" \
  -d "'{\"fromParty\":\"treasury\",\"toPartyOrEns\":\"UBS::trading\",\"amountMicro\":\"5000000\"}'" | jqget "['txid']"
sleep 2
UBS_TRADING=$(eval curl $UBS/portfolio | jqget "['balances']['trading']")
[ "$UBS_TRADING" = "5000000" ] || { echo "internal transfer failed"; exit 1; }
echo "   UBS trading = $UBS_TRADING ✓"

echo "── resync --from-zero on DRW: wipe projection, replay chain"
eval curl -X POST $DRW/resync | jqget "['ok']"
sleep 1
DRW_BAL2=$(eval curl $DRW/portfolio | jqget "['balances']['desk']")
[ "$DRW_BAL2" = "12000000" ] || { echo "resync lost state: $DRW_BAL2"; exit 1; }
echo "   DRW desk after resync = $DRW_BAL2 ✓ (the database is a disposable cache)"

echo ""
echo "✅ P2 GATE GREEN — two Rings, relayer, X1 via API, convergence, resync"
