#!/usr/bin/env bash
# P4 gate: X4 full repo cycle (propose+allocate → atomic accept → time-warp → auto-close)
# and I6 payroll (run + claim, server-proved), driven via the /v1 API only.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
RPC=http://127.0.0.1:8546

set -a; source .env.local 2>/dev/null || true; set +a
cleanup() { kill $(jobs -p) 2>/dev/null || true; }
trap cleanup EXIT

echo "── stack"
docker compose -f infra/docker-compose.yml up -d --wait 2>/dev/null
for db in ring_ubs ring_drw; do
  docker exec aragorn-postgres psql -U aragorn -d postgres -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE);"
  docker exec aragorn-postgres psql -U aragorn -d postgres -q -c "CREATE DATABASE $db;"
done
pkill -f "anvil --port 8546" 2>/dev/null || true
sleep 0.5
anvil --port 8546 --disable-code-size-limit --block-time 1 --silent &
sleep 1.5
RPC_URL=$RPC bun scripts/deploy.ts > /dev/null

REGISTRY=$(python3 -c "import json; print(json.load(open('contracts/deployments.local.json'))['registry'])")
VAULT=$(python3 -c "import json; print(json.load(open('contracts/deployments.local.json'))['vault'])")
USDC=$(python3 -c "import json; print(json.load(open('contracts/deployments.local.json'))['usdc'])")

UBS_FUND_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
DRW_FUND_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
cast send $USDC "mint(address,uint256)" $(cast wallet address $UBS_FUND_KEY) 100000000000000 --rpc-url $RPC \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 -q
cast send $USDC "mint(address,uint256)" $(cast wallet address $DRW_FUND_KEY) 100000000000000 --rpc-url $RPC \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 -q

echo "── seed the Goldman bond (\$5M face → UBS::trading)"
RPC_URL=$RPC bun scripts/seed-bond.ts

RPC_URL=$RPC PORT=4900 bun apps/coordinator/src/index.ts &

RING_ORG_NAME=UBS PORT=4001 RING_ENS=ubs.aragornrings.eth \
  DATABASE_URL=postgres://aragorn:aragorn@127.0.0.1:5434/ring_ubs \
  RPC_URL=$RPC NOTE_REGISTRY_ADDR=$REGISTRY USDC_ADDR=$USDC SHIELD_VAULT_ADDR=$VAULT \
  RELAYER_URL=http://127.0.0.1:4900 RELAYER_TOKEN=ubs-relay-token API_TOKEN=ubs-api-token \
  ORG_ENC_PRIV=0x1111111111111111111111111111111111111111111111111111111111111111 \
  PARTY_KEYS='{"treasury":"0x111","trading":"0x112"}' \
  FUNDING_EOA_PRIVATE_KEY=$UBS_FUND_KEY \
  BISCUIT_ROOT_PRIV="ed25519-private/1111111111111111111111111111111111111111111111111111111111111111" \
  GATEWAY_SIGNER_KEY=0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba \
  SEPOLIA_RPC_URL="$SEPOLIA_RPC_URL" \
  node --experimental-wasm-modules --experimental-transform-types --no-warnings apps/ring/src/index.ts &

RING_ORG_NAME=DRW PORT=4002 RING_ENS=drw.aragornrings.eth \
  DATABASE_URL=postgres://aragorn:aragorn@127.0.0.1:5434/ring_drw \
  RPC_URL=$RPC NOTE_REGISTRY_ADDR=$REGISTRY USDC_ADDR=$USDC SHIELD_VAULT_ADDR=$VAULT \
  RELAYER_URL=http://127.0.0.1:4900 RELAYER_TOKEN=drw-relay-token API_TOKEN=drw-api-token \
  ORG_ENC_PRIV=0x2222222222222222222222222222222222222222222222222222222222222222 \
  PARTY_KEYS='{"desk":"0x221"}' \
  FUNDING_EOA_PRIVATE_KEY=$DRW_FUND_KEY \
  BISCUIT_ROOT_PRIV="ed25519-private/2222222222222222222222222222222222222222222222222222222222222222" \
  SEPOLIA_RPC_URL="$SEPOLIA_RPC_URL" \
  node --experimental-wasm-modules --experimental-transform-types --no-warnings apps/ring/src/index.ts &

for port in 4900 4001 4002; do
  for i in $(seq 1 60); do
    curl -sf http://127.0.0.1:$port/health > /dev/null && break
    sleep 0.5
    [ "$i" = 60 ] && { echo "service :$port failed"; exit 1; }
  done
done
echo "   services up"

UBS="-H 'authorization: Bearer ubs-api-token' -s http://127.0.0.1:4001/v1"
DRW="-H 'authorization: Bearer drw-api-token' -s http://127.0.0.1:4002/v1"
jqget() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }

echo "── whitelists (both directions, live Sepolia)"
eval curl -X POST $UBS/whitelist -H "'content-type: application/json'" -d "'{\"ensName\":\"drw.aragornrings.eth\"}'" > /dev/null
eval curl -X POST $DRW/whitelist -H "'content-type: application/json'" -d "'{\"ensName\":\"ubs.aragornrings.eth\"}'" > /dev/null
echo "   ok"

echo "── shield: UBS \$1,000→treasury + \$2,000→trading (interest float), DRW \$6M→desk [proving…]"
eval curl -X POST $UBS/shield -H "'content-type: application/json'" -d "'{\"party\":\"treasury\",\"amountMicro\":\"1000000000\"}'" | jqget "['txid']" > /dev/null
eval curl -X POST $UBS/shield -H "'content-type: application/json'" -d "'{\"party\":\"trading\",\"amountMicro\":\"2000000000\"}'" | jqget "['txid']" > /dev/null
eval curl -X POST $DRW/shield -H "'content-type: application/json'" -d "'{\"party\":\"desk\",\"amountMicro\":\"6000000000000\"}'" | jqget "['txid']" > /dev/null
echo "   ok"

sleep 2
BOND_CID=$(eval curl "$UBS/contracts?template=2" | jqget "['contracts'][0]['cid']")
echo "── bond visible at UBS: $BOND_CID"

echo "── X4.1 propose: UBS books \$5M overnight repo vs the bond at 530bps with DRW [proving…]"
PROPOSE=$(eval curl -X POST $UBS/repos -H "'content-type: application/json'" \
  -d "'{\"dealerParty\":\"trading\",\"counterpartyEns\":\"drw.aragornrings.eth\",\"collateralCid\":\"$BOND_CID\",\"cashAmountMicro\":\"5000000000000\",\"rateBps\":\"530\",\"days\":\"1\"}'")
echo "$PROPOSE" | jqget "['txid']"

sleep 3
echo "── X4.2 DRW inbox shows the inbound proposal"
DRW_WF=$(eval curl $DRW/repos | jqget "['repos'][0]")
DRW_WF_ID=$(eval curl $DRW/repos | jqget "['repos'][0]['id']")
DRW_WF_STATUS=$(eval curl $DRW/repos | jqget "['repos'][0]['status']")
[ "$DRW_WF_STATUS" = "inbound" ] || { echo "no inbound proposal: $DRW_WF"; exit 1; }
echo "   inbound workflow #$DRW_WF_ID ✓"

echo "── X4.3 DRW accepts: atomic DvP [proving…]"
ACCEPT=$(eval curl -X POST $DRW/repos/$DRW_WF_ID/accept)
echo "$ACCEPT" | grep -q txid || { echo "accept failed: $ACCEPT"; exit 1; }
echo "$ACCEPT" | jqget "['txid']"

sleep 3
UBS_TRADING_BAL=$(eval curl $UBS/portfolio | jqget "['balances'].get('trading','0')")
[ "$UBS_TRADING_BAL" = "5000000000000" ] || { echo "dealer cash wrong: $UBS_TRADING_BAL"; exit 1; }
UBS_REPO_STATUS=$(eval curl $UBS/repos | jqget "['repos'][0]['status']")
[ "$UBS_REPO_STATUS" = "live" ] || { echo "UBS workflow not live: $UBS_REPO_STATUS"; exit 1; }
echo "   UBS received \$5M principal; agreement live on both books ✓"

echo "── X4.4 time-warp 1 day + auto-close via maturity cron"
cast rpc evm_increaseTime 86460 --rpc-url $RPC > /dev/null
cast rpc evm_mine --rpc-url $RPC > /dev/null
for i in $(seq 1 30); do
  STATUS=$(eval curl $UBS/repos | jqget "['repos'][0]['status']")
  [ "$STATUS" = "closed" ] && break
  sleep 2
  [ "$i" = 30 ] && { echo "auto-close never fired (status $STATUS)"; exit 1; }
done
REPURCHASE=$(eval curl $UBS/repos | jqget "['repos'][0]['state'].get('repurchaseMicro')")
[ "$REPURCHASE" = "5000736111111" ] || { echo "wrong repurchase: $REPURCHASE"; exit 1; }
echo "   auto-closed; repurchase = \$5,000,736.111111 (530bps, ACT/360, in-circuit) ✓"

sleep 3
DRW_BAL=$(eval curl $DRW/portfolio | jqget "['balances']['desk']")
[ "$DRW_BAL" = "6000736111111" ] || { echo "lender balance wrong: $DRW_BAL"; exit 1; }
UBS_BOND=$(eval curl "$UBS/contracts?template=2" | python3 -c "
import json,sys
rows = json.load(sys.stdin)['contracts']
active = [r for r in rows if r['status'] == 'active']
assert len(active) == 1, f'want 1 active bond, got {len(active)}'
assert int(active[0]['payload']['encumbrance'], 16) == 0, 'bond still encumbered'
print('unencumbered, back with UBS')")
echo "   DRW earned \$736.11 interest; bond $UBS_BOND ✓"

echo "── I6 payroll: 3 employees, run + one server-proved claim [proving…]"
for emp in cat alice bob; do
  eval curl -X POST $UBS/employees -H "'content-type: application/json'" -d "'{\"subnameLabel\":\"$emp\"}'" > /dev/null
done
PAYROLL=$(eval curl -X POST $UBS/payroll/run -H "'content-type: application/json'" \
  -d "'{\"payerParty\":\"treasury\",\"payments\":[{\"employeeId\":1,\"amountMicro\":\"120000000\"},{\"employeeId\":2,\"amountMicro\":\"95000000\"},{\"employeeId\":3,\"amountMicro\":\"110000000\"}]}'")
echo "$PAYROLL" | jqget "['txids'][0]"
sleep 2
CLAIM=$(eval curl -X POST $UBS/payroll/claim -H "'content-type: application/json'" -d "'{\"employeeId\":1}'")
echo "   claim: $(echo "$CLAIM" | jqget "['txid']") ✓"
ITEM_STATUS=$(eval curl $UBS/payroll/items | python3 -c "
import json,sys
items = json.load(sys.stdin)['items']
claimed = [i for i in items if i['status'] == 'claimed']
claimable = [i for i in items if i['status'] == 'claimable']
print(f'{len(claimed)} claimed, {len(claimable)} claimable')")
echo "   $ITEM_STATUS ✓"

echo ""
echo "✅ P4 GATE GREEN — full repo cycle (incl. auto-close w/ in-circuit interest) + payroll"
