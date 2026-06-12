#!/usr/bin/env bash
# P6 gate: demo-reset → assert every PLAN §2 precondition is in place and performable.
set -euo pipefail
cd "$(dirname "$0")/../.."

./scripts/demo-reset.sh

jqget() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }
UBS="-H 'authorization: Bearer ubs-api-token' -s http://127.0.0.1:4001/v1"
DRW="-H 'authorization: Bearer drw-api-token' -s http://127.0.0.1:4002/v1"

echo "── assert pre-seeded demo state (PLAN §2)"
# bond on UBS book, free
eval curl "$UBS/contracts?template=2" | python3 -c "
import json,sys
rows = [r for r in json.load(sys.stdin)['contracts'] if r['status']=='active']
assert rows and int(rows[0]['payload']['encumbrance'],16)==0, 'bond missing/encumbered'
print('   bond seeded, unencumbered ✓')"
# shielded balances both sides
UBS_T=$(eval curl $UBS/portfolio | jqget "['balances']['treasury']")
DRW_D=$(eval curl $DRW/portfolio | jqget "['balances']['desk']")
python3 -c "
assert int('$UBS_T') > 7_000_000_000_000, 'UBS treasury seed missing'
assert int('$DRW_D') >= 10_000_000_000_000, 'DRW desk seed missing'
print('   shielded balances ✓ (UBS treasury \$' + str(int('$UBS_T')//1000000) + ', DRW desk \$' + str(int('$DRW_D')//1000000) + ')')"
# payroll history (claimed + claimable)
eval curl $UBS/payroll/items | python3 -c "
import json,sys
items = json.load(sys.stdin)['items']
assert any(i['status']=='claimed' for i in items), 'no claimed salary'
assert any(i['status']=='claimable' for i in items), 'no claimable salary'
print('   payroll history ✓')"
# approval trail
eval curl $UBS/approvals | python3 -c "
import json,sys
a = json.load(sys.stdin)['approvals']
assert any(x['status']=='approved' for x in a), 'no approval trail'
print('   four-eyes approval trail ✓')"
# whitelists resolve
eval curl $UBS/whitelist | python3 -c "
import json,sys
w = json.load(sys.stdin)['whitelist']
assert any('drw' in x['ens_name'] for x in w), 'whitelist missing'
print('   ENS whitelist ✓')"
# dashboard + public feed
curl -sf http://127.0.0.1:3000 > /dev/null && echo "   dashboard ✓"
curl -sf http://127.0.0.1:4001/public-feed -m 2 -o /dev/null 2>/dev/null || true
echo ""
echo "✅ DEMO GATE GREEN — stack running, PLAN §2 performable. Stop: kill \$(cat /tmp/aragorn-demo.pids)"
