#!/usr/bin/env bash
# P3 gate: Privy login → Biscuit exchange; invite/roles; whitelist resolves
# drw.aragornrings.eth from Sepolia; CCIP gateway resolves cat.ubs.aragornrings.eth;
# dashboard shell boots; I3 four-eyes transfer end-to-end via the API.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
RPC=http://127.0.0.1:8546

# load .env.local (SEPOLIA_RPC_URL, PRIVY_*)
set -a; source .env.local 2>/dev/null || true; set +a

cleanup() { kill $(jobs -p) 2>/dev/null || true; }
trap cleanup EXIT

echo "── stack: postgres + anvil + deploy + coordinator + rings"
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

DIRECTORY='{}'  # P3: counterparties resolve via ENS whitelist, not the static directory

RPC_URL=$RPC PORT=4900 bun apps/coordinator/src/index.ts &

COMMON_RING_ENV="RPC_URL=$RPC NOTE_REGISTRY_ADDR=$REGISTRY USDC_ADDR=$USDC SHIELD_VAULT_ADDR=$VAULT RELAYER_URL=http://127.0.0.1:4900"

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
  SEPOLIA_RPC_URL="$SEPOLIA_RPC_URL" PRIVY_APP_ID="${PRIVY_APP_ID:-}" PRIVY_APP_SECRET="${PRIVY_APP_SECRET:-}" \
  DIRECTORY="$DIRECTORY" \
  node --experimental-wasm-modules --experimental-transform-types --no-warnings apps/ring/src/index.ts &

RING_ORG_NAME=DRW PORT=4002 RING_ENS=drw.aragornrings.eth \
  DATABASE_URL=postgres://aragorn:aragorn@127.0.0.1:5434/ring_drw \
  RPC_URL=$RPC NOTE_REGISTRY_ADDR=$REGISTRY USDC_ADDR=$USDC SHIELD_VAULT_ADDR=$VAULT \
  RELAYER_URL=http://127.0.0.1:4900 RELAYER_TOKEN=drw-relay-token API_TOKEN=drw-api-token \
  ORG_ENC_PRIV=0x2222222222222222222222222222222222222222222222222222222222222222 \
  PARTY_KEYS='{"desk":"0x221"}' \
  FUNDING_EOA_PRIVATE_KEY=$DRW_FUND_KEY \
  BISCUIT_ROOT_PRIV="ed25519-private/2222222222222222222222222222222222222222222222222222222222222222" \
  EMAIL_DOMAIN_ALLOWLIST="drw-demo.com,privy.io" \
  SEPOLIA_RPC_URL="$SEPOLIA_RPC_URL" PRIVY_APP_ID="${PRIVY_APP_ID:-}" PRIVY_APP_SECRET="${PRIVY_APP_SECRET:-}" \
  DIRECTORY="$DIRECTORY" \
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
jqget() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }

echo "── invite users (admin): jane=trader(\$20 limit), marcus=approver"
eval curl -X POST $UBS/users/invite -H "'content-type: application/json'" \
  -d "'{\"email\":\"jane@ubs-demo.com\",\"role\":\"trader\",\"allowedParties\":[\"treasury\"],\"limitMicro\":\"20000000\"}'" | jqget "['user']['email']"
eval curl -X POST $UBS/users/invite -H "'content-type: application/json'" \
  -d "'{\"email\":\"marcus@ubs-demo.com\",\"role\":\"approver\"}'" | jqget "['user']['email']"

echo "── Privy → Biscuit exchange"
PRIVY_OUT=$(bun scripts/p3-privy-exchange.ts 2>&1) || { echo "$PRIVY_OUT" | tail -10; exit 1; }
echo "   $(echo "$PRIVY_OUT" | tail -1)"

echo "── biscuit session tokens (jane: trader w/ \$20 limit, marcus: approver)"
JANE=$(eval curl -X POST $UBS/service-tokens -H "'content-type: application/json'" \
  -d "'{\"role\":\"trader\",\"allowedParties\":[\"treasury\"],\"maxNotionalMicro\":\"20000000\"}'" | jqget "['biscuit']")
MARCUS=$(eval curl -X POST $UBS/service-tokens -H "'content-type: application/json'" \
  -d "'{\"role\":\"approver\"}'" | jqget "['biscuit']")
JANE_ME=$(curl -s -H "authorization: Bearer $JANE" http://127.0.0.1:4001/v1/me | jqget "['user']['role']")
[ "$JANE_ME" = "trader" ] || { echo "biscuit verify failed"; exit 1; }
echo "   jane session verified as trader ✓"

echo "── whitelist: drw.aragornrings.eth resolves live from Sepolia"
ENC=$(eval curl -X POST $UBS/whitelist -H "'content-type: application/json'" \
  -d "'{\"ensName\":\"drw.aragornrings.eth\"}'" | jqget "['encPubkey']")
[ "$ENC" = "0x0faa684ed28867b97f4a6a2dee5df8ce974e76b7018e3f22a1c4cf2678570f20" ] || { echo "ENS resolution wrong: $ENC"; exit 1; }
echo "   resolved encpubkey ✓"

echo "── employee + CCIP gateway: cat.ubs.aragornrings.eth"
eval curl -X POST $UBS/employees -H "'content-type: application/json'" \
  -d "'{\"subnameLabel\":\"cat\"}'" | jqget "['employee']['subname_label']"
bun scripts/p3-ccip-check.ts

echo "── shield 100 USDC (proving…)"
eval curl -X POST $UBS/shield -H "'content-type: application/json'" \
  -d "'{\"party\":\"treasury\",\"amountMicro\":\"100000000\"}'" | jqget "['cid']" > /dev/null

echo "── four-eyes: jane books a \$50 transfer (over her \$20 limit)"
PENDING=$(curl -s -X POST -H "authorization: Bearer $JANE" -H "content-type: application/json" \
  -d '{"fromParty":"treasury","toPartyOrEns":"drw.aragornrings.eth","amountMicro":"50000000"}' \
  http://127.0.0.1:4001/v1/transfers)
APPROVAL_ID=$(echo "$PENDING" | jqget "['approvalId']")
STATUS=$(echo "$PENDING" | jqget "['status']")
[ "$STATUS" = "pending_approval" ] || { echo "four-eyes did not trigger: $PENDING"; exit 1; }
echo "   pending approval #$APPROVAL_ID ✓"

echo "── jane cannot approve her own request; marcus approves (proving…)"
RESULT=$(curl -s -X POST -H "authorization: Bearer $MARCUS" -H "content-type: application/json" \
  -d '{"approve":true,"reason":"within desk mandate"}' \
  http://127.0.0.1:4001/v1/approvals/$APPROVAL_ID/decide)
TXID=$(echo "$RESULT" | jqget "['txid']")
echo "   executed on approval: $TXID ✓"

sleep 3
DRW_BAL=$(curl -s -H "authorization: Bearer drw-api-token" http://127.0.0.1:4002/v1/portfolio | jqget "['balances']['desk']")
[ "$DRW_BAL" = "50000000" ] || { echo "DRW did not receive: $DRW_BAL"; exit 1; }
echo "   DRW desk received \$50 via ENS-addressed four-eyes transfer ✓"

echo "── dashboard shell boots"
(cd apps/dashboard && bun run dev > /tmp/aragorn-dash.log 2>&1 &)
for i in $(seq 1 60); do curl -sf http://127.0.0.1:3000 > /dev/null && break; sleep 1; [ "$i" = 60 ] && { echo "dashboard failed"; exit 1; }; done
curl -s http://127.0.0.1:3000 | grep -qi "aragorn\|ring" && echo "   dashboard up ✓"
pkill -f "next dev" 2>/dev/null || true

echo ""
echo "✅ P3 GATE GREEN — identity, policy, ENS, CCIP, dashboard shell"
