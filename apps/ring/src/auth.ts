// Identity & control plane (BUILD_SPEC §6.2, PLAN §5.1).
// Humans: Privy JWT → short-lived session Biscuit. Services: admin-minted Biscuits.
// ONE policy path: every mutating route checks Biscuit facts (role, limit).
import {
  KeyPair,
  PrivateKey,
  SignatureAlgorithm,
  Biscuit,
  biscuit,
  fact,
  authorizer,
  rule,
} from "@biscuit-auth/biscuit-wasm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Sql } from "./db.ts";

export type Role = "admin" | "trader" | "approver" | "viewer" | "auditor" | "employee";

export interface SessionUser {
  email: string;
  role: Role;
  limitMicro: bigint | null; // null = unlimited
  allowedParties: string[] | null; // null = all parties (admin/service)
  service?: boolean;
}

const QUERY_LIMITS = { max_facts: 1000, max_iterations: 100, max_time_micro: 200_000 };

export class AuthService {
  readonly root: KeyPair;
  private jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

  constructor(
    private sql: Sql,
    biscuitRootPriv: string | undefined,
    private privyAppId: string | undefined,
    private privyAppSecret: string | undefined,
    private emailDomainAllowlist: string[],
  ) {
    this.root = biscuitRootPriv
      ? KeyPair.fromPrivateKey(PrivateKey.fromString(biscuitRootPriv))
      : new KeyPair(SignatureAlgorithm.Ed25519);
    if (privyAppId) {
      // JWKS verification covers both production and test-mode tokens (the SDK's static
      // verification key path rejects test tokens — different kid)
      this.jwks = createRemoteJWKSet(
        new URL(`https://auth.privy.io/api/v1/apps/${privyAppId}/jwks.json`),
      );
    }
  }

  /** Privy JWT → session Biscuit (1h) carrying the user's entitlement facts. */
  async exchange(privyToken: string): Promise<{ biscuit: string; user: SessionUser }> {
    if (!this.jwks || !this.privyAppId) throw new Error("privy not configured");
    const { payload } = await jwtVerify(privyToken, this.jwks, {
      issuer: "privy.io",
      audience: this.privyAppId,
    });
    const did = payload.sub as string;

    let [row] = await this.sql`SELECT * FROM users WHERE privy_did = ${did}`;
    if (!row) {
      // first login: bind the Privy DID to the invited user with this email
      const res = await fetch(`https://api.privy.io/v1/users/${did}`, {
        headers: {
          "privy-app-id": this.privyAppId,
          authorization: `Basic ${Buffer.from(`${this.privyAppId}:${this.privyAppSecret}`).toString("base64")}`,
        },
      });
      if (!res.ok) throw new Error(`privy user lookup failed (${res.status})`);
      const privyUser = (await res.json()) as any;
      const email: string | undefined =
        privyUser?.linked_accounts?.find((a: any) => a.type === "email")?.address ??
        privyUser?.email?.address;
      if (!email) throw new Error("privy user has no email");
      // An explicit admin invite is authority enough — invited users bypass the domain
      // gate. The allowlist only restricts who self-signup could onboard (we don't
      // auto-create users, so an un-invited email is rejected regardless).
      const updated = await this.sql`
        UPDATE users SET privy_did = ${did} WHERE email = ${email} AND privy_did IS NULL
        RETURNING *`;
      if (!updated.length) {
        const domain = email.split("@")[1];
        if (this.emailDomainAllowlist.length && !this.emailDomainAllowlist.includes(domain)) {
          throw new Error(`email domain ${domain} not allowed`);
        }
        throw new Error(`no invite for ${email} — ask an admin`);
      }
      row = updated[0];
    }

    const user: SessionUser = {
      email: row.email,
      role: row.role,
      limitMicro: row.notional_limit_micro === null ? null : BigInt(row.notional_limit_micro),
      allowedParties: row.allowed_parties ?? null,
    };
    return { biscuit: this.mint(user, 3600), user };
  }

  /** Mint a Biscuit for a user session or a service integration (same fact schema). */
  mint(user: SessionUser, ttlSeconds: number): string {
    const expiry = new Date(Date.now() + ttlSeconds * 1000);
    const builder = biscuit`
      user(${user.email});
      role(${user.role});
      limit(${user.limitMicro === null ? -1 : Number(user.limitMicro)});
      check if time($t), $t < ${expiry};
    `;
    if (user.service) builder.addFact(fact`service(true)`);
    for (const party of user.allowedParties ?? []) builder.addFact(fact`party(${party})`);
    return builder.build(this.root.getPrivateKey()).toBase64();
  }

  /** Verify a Biscuit (signature + expiry) and extract the session facts. */
  verify(token: string): SessionUser {
    const parsed = Biscuit.fromBase64(token, this.root.getPublicKey());
    const auth = authorizer`time(${new Date()}); allow if user($u);`.buildAuthenticated(parsed);
    auth.authorizeWithLimits(QUERY_LIMITS); // throws on expiry/bad signature

    const q = (r: any) => auth.queryWithLimits(r, QUERY_LIMITS).map((f: any) => f.terms()[0]);
    const emails = q(rule`q($u) <- user($u)`);
    const roles = q(rule`q($r) <- role($r)`);
    const limits = q(rule`q($l) <- limit($l)`);
    const parties = q(rule`q($p) <- party($p)`).map(String);
    const service = q(rule`q($s) <- service($s)`).length > 0;
    const limit = Number(limits[0] ?? -1);
    return {
      email: String(emails[0] ?? "service"),
      role: (roles[0] ?? "viewer") as Role,
      limitMicro: limit < 0 ? null : BigInt(limit),
      allowedParties: parties.length ? parties : null,
      service,
    };
  }
}
