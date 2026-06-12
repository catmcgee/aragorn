// P3 helper: real Privy test-account token → Ring /auth/exchange → session Biscuit → /v1/me.
// Proves the human login path end-to-end without a browser.
import { readFileSync } from "fs";
import { PrivyClient } from "@privy-io/node";
import { createRemoteJWKSet, jwtVerify } from "jose";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const RING = process.env.RING_URL ?? "http://127.0.0.1:4001";

const privy = new PrivyClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET });
const { access_token } = await privy.apps().getTestAccessToken();

// the test user must be invited first (the ring rejects unknown emails)
const jwks = createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${env.PRIVY_APP_ID}/jwks.json`));
const { payload } = await jwtVerify(access_token, jwks, { issuer: "privy.io", audience: env.PRIVY_APP_ID });
const did = payload.sub as string;
const userRes = await fetch(`https://api.privy.io/v1/users/${did}`, {
  headers: {
    "privy-app-id": env.PRIVY_APP_ID,
    authorization: `Basic ${Buffer.from(`${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`).toString("base64")}`,
  },
});
const user = (await userRes.json()) as any;
const email =
  user?.linked_accounts?.find((a: any) => a.type === "email")?.address ?? user?.email?.address;

const invite = await fetch(`${RING}/v1/users/invite`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer ubs-api-token" },
  body: JSON.stringify({ email, role: "trader", actAs: ["treasury"], limitMicro: "1000000000" }),
});
if (!invite.ok) throw new Error(`invite failed: ${await invite.text()}`);

const res = await fetch(`${RING}/auth/exchange`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ privyToken: access_token }),
});
const body = (await res.json()) as any;
if (!res.ok) throw new Error(`exchange failed: ${body.error}`);

const me = await fetch(`${RING}/v1/me`, {
  headers: { authorization: `Bearer ${body.biscuit}` },
});
const meBody = (await me.json()) as any;
if (meBody.user?.email !== email) throw new Error(`me mismatch: ${JSON.stringify(meBody)}`);
console.log(`privy login → biscuit → /me ok (${email}, role ${meBody.user.role}) ✓`);
