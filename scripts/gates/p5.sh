#!/usr/bin/env bash
# P5 gate: B2 Privy Earn (REAL Base chain) — position + APY + a live deposit via the API;
# in-browser proving path for the payroll claim (exact worker code, run headless).
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; source .env.local 2>/dev/null || true; set +a

echo "── Earn: live position + APY from Base (Gauntlet USDC Prime / Morpho)"
bun scripts/p5-earn-check.ts

echo "── browser claim prover: the worker's exact witness+proof code, headless"
bun apps/dashboard/scripts/test-prove.ts | tail -3

echo ""
echo "✅ P5 GATE GREEN — real-chain yield + local salary proving"
