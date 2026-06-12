// Demo seed (BUILD_SPEC §10) — everything via the public API (API-first invariant):
// users/roles, whitelists, shields, payroll history (run + one claim), one completed
// four-eyes internal transfer. The bond is seeded on-chain by seed-bond.ts beforehand.
import { RingClient } from "../packages/sdk/src/index.ts";

const UBS = new RingClient("http://127.0.0.1:4001", "ubs-api-token");
const DRW = new RingClient("http://127.0.0.1:4002", "drw-api-token");
const $ = (n: number) => BigInt(Math.round(n * 1e6));

const step = (s: string) => console.log(`   ${s}`);

// 1. users & roles (§10.7)
step("users: UBS {admin, jane=trader($1M limit), marcus=approver, auditor} + DRW {admin, trader}");
await UBS.inviteUser("admin@ubs-demo.com", "admin", ["treasury", "trading"]);
await UBS.inviteUser("jane@ubs-demo.com", "trader", ["treasury", "trading"], $(1_000_000));
await UBS.inviteUser("marcus@ubs-demo.com", "approver", []);
await UBS.inviteUser("auditor@ubs-demo.com", "auditor", []);
await DRW.inviteUser("admin@drw-demo.com", "admin", ["desk"]);
await DRW.inviteUser("trader@drw-demo.com", "trader", ["desk"], $(10_000_000));

// 2. counterparty whitelists via live Sepolia ENS (§10.8 idempotent)
step("whitelists: live ENSv2 resolution both directions");
await UBS.addWhitelist("drw.aragornrings.eth");
await DRW.addWhitelist("ubs.aragornrings.eth");

// 3. employees + subnames
step("employees: cat, alice, bob (CCIP subnames under ubs.aragornrings.eth)");
// sdk has no employees method; raw calls:
async function raw(client: "ubs" | "drw", method: string, path: string, body?: unknown) {
  const base = client === "ubs" ? "http://127.0.0.1:4001" : "http://127.0.0.1:4002";
  const token = client === "ubs" ? "ubs-api-token" : "drw-api-token";
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) throw new Error(`${path}: ${JSON.stringify(json).slice(0, 150)}`);
  return json as any;
}
for (const [label, email] of [["cat", "cat@ubs-demo.com"], ["alice", undefined], ["bob", undefined]] as const) {
  await raw("ubs", "POST", "/v1/employees", { subnameLabel: label, email });
}

// 4. shields (§10.2): $10M UBS treasury, $10M DRW desk [2 proofs]
step("shield $10M → UBS::treasury (proving…)");
await UBS.shield("treasury", $(10_000_000));
step("shield $10M → DRW::desk (proving…)");
await DRW.shield("desk", $(10_000_000));

// 5. payroll history (§10.5): one run, one claim [2 proofs]
step("payroll run: 3 employees (proving…)");
const employees = (await raw("ubs", "GET", "/v1/employees")).employees as { id: number }[];
await raw("ubs", "POST", "/v1/payroll/run", {
  payerParty: "treasury",
  payments: [
    { employeeId: employees[0].id, amountMicro: $(12_500).toString() },
    { employeeId: employees[1].id, amountMicro: $(9_800).toString() },
    { employeeId: employees[2].id, amountMicro: $(11_200).toString() },
  ],
});
await new Promise((r) => setTimeout(r, 2500));
step("salary claim: employee #1 (proving…)");
await raw("ubs", "POST", "/v1/payroll/claim", { employeeId: employees[0].id });

// 6. internal transfer history with approval trail (§10.6) [1 proof]
step("four-eyes history: jane books $2M treasury→trading, marcus approves (proving…)");
const jane = (await raw("ubs", "POST", "/v1/service-tokens", {
  role: "trader",
  actAs: ["treasury"],
  maxNotionalMicro: $(1_000_000).toString(),
})).biscuit as string;
const marcus = (await raw("ubs", "POST", "/v1/service-tokens", { role: "approver", actAs: [] }))
  .biscuit as string;
const pending = await fetch("http://127.0.0.1:4001/v1/transfers", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${jane}` },
  body: JSON.stringify({ fromParty: "treasury", toPartyOrEns: "UBS::trading", amountMicro: $(2_000_000).toString() }),
}).then((r) => r.json() as any);
await fetch(`http://127.0.0.1:4001/v1/approvals/${pending.approvalId}/decide`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${marcus}` },
  body: JSON.stringify({ approve: true, reason: "desk funding, within mandate" }),
});

const [ubsP, drwP] = await Promise.all([UBS.portfolio(), DRW.portfolio()]);
console.log("   UBS:", JSON.stringify(ubsP.balances), "| DRW:", JSON.stringify(drwP.balances));
console.log("✅ demo state seeded");
