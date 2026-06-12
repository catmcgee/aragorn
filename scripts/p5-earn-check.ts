// P5 helper: assert the Earn integration is live against REAL Base — position, APY,
// and a $1 deposit round through Privy's Earn API.
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const headers = {
  "content-type": "application/json",
  "privy-app-id": env.PRIVY_APP_ID,
  authorization: `Basic ${Buffer.from(`${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`).toString("base64")}`,
};
const W = env.PRIVY_EARN_WALLET_ID;
const V = env.PRIVY_EARN_VAULT_ID;

const pos = (await (
  await fetch(`https://api.privy.io/api/v1/wallets/${W}/earn/ethereum/vaults?vault_id=${V}`, { headers })
).json()) as any;
const p = Array.isArray(pos?.vaults) ? pos.vaults[0] : (pos?.vaults ?? pos);
const inVault = BigInt(p?.assets_in_vault ?? 0);
if (inVault <= 0n) throw new Error(`no Earn position: ${JSON.stringify(pos).slice(0, 200)}`);

const vault = (await (
  await fetch(`https://api.privy.io/v1/earn/ethereum/vaults/${V}`, { headers })
).json()) as any;
if (!vault.user_apy || vault.provider !== "morpho") throw new Error(`bad vault: ${JSON.stringify(vault).slice(0, 150)}`);

console.log(
  `   position $${(Number(inVault) / 1e6).toFixed(2)} in ${vault.name} | APY ${(vault.user_apy / 100).toFixed(2)}% | TVL $${Math.round(vault.tvl_usd).toLocaleString()} ✓`,
);

// live $1 deposit (real chain)
const dep = await fetch(`https://api.privy.io/api/v1/wallets/${W}/earn/ethereum/deposit`, {
  method: "POST",
  headers,
  body: JSON.stringify({ vault_id: V, raw_amount: "1000000" }),
});
const depBody = (await dep.json()) as any;
if (!dep.ok || !["pending", "succeeded"].includes(depBody.status))
  throw new Error(`deposit failed: ${JSON.stringify(depBody).slice(0, 200)}`);
console.log(`   live $1 deposit accepted (action ${depBody.id}, status ${depBody.status}) ✓`);
