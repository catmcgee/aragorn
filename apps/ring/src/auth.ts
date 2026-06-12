// Identity & control plane (BUILD_SPEC §6.2, PLAN §5.1).
// Humans: Privy JWT → short-lived session Biscuit. Services: admin-minted Biscuits.
// ONE policy path: every mutating route checks Biscuit facts (role, act_as, limit).
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
import { PrivyClient } from "@privy-io/node";
import type { Sql } from "./db.ts";

export type Role = "admin" | "trader" | "approver" | "viewer" | "auditor" | "employee";

export interface SessionUser {
  email: string;
  role: Role;
  actAs: string[];
  limitMicro: bigint | null; // null = unlimited
  service?: boolean;
}

const QUERY_LIMITS = { max_facts: 1000, max_iterations: 100, max_time_micro: 200_000 };

export class AuthService {
  readonly root: KeyPair;
  private privy: PrivyClient | undefined;

  constructor(
    private sql: Sql,
    biscuitRootPriv: string | undefined,
    privyAppId: string | undefined,
    privyAppSecret: string | undefined,
    private emailDomainAllowlist: string[],
  ) {
    this.root = biscuitRootPriv
      ? KeyPair.fromPrivateKey(PrivateKey.fromString(biscuitRootPriv))
      : new KeyPair(SignatureAlgorithm.Ed25519);
    if (privyAppId && privyAppSecret) {
      this.privy = new PrivyClient({ appId: privyAppId, appSecret: privyAppSecret });
    }
  }

  /** Privy JWT → session Biscuit (1h) carrying the user's entitlement facts. */
  async exchange(privyToken: string): Promise<{ biscuit: string; user: SessionUser }> {
    if (!this.privy) throw new Error("privy not configured");
    const claims = await this.privy.utils().auth().verifyAccessToken({ access_token: privyToken });
    const did: string = (claims as any).sub ?? (claims as any).user_id;

    let [row] = await this.sql`SELECT * FROM users WHERE privy_did = ${did}`;
    if (!row) {
      // first login: bind the Privy DID to the invited user with this email
      const privyUser = await this.privy.users().get(did);
      const email: string | undefined =
        (privyUser as any)?.linked_accounts?.find((a: any) => a.type === "email")?.address ??
        (privyUser as any)?.email?.address;
      if (!email) throw new Error("privy user has no email");
      const domain = email.split("@")[1];
      if (this.emailDomainAllowlist.length && !this.emailDomainAllowlist.includes(domain)) {
        throw new Error(`email domain ${domain} not allowed`);
      }
      const updated = await this.sql`
        UPDATE users SET privy_did = ${did} WHERE email = ${email} AND privy_did IS NULL
        RETURNING *`;
      if (!updated.length) throw new Error(`no invite for ${email} — ask an admin`);
      row = updated[0];
    }

    const user: SessionUser = {
      email: row.email,
      role: row.role,
      actAs: row.act_as ?? [],
      limitMicro: row.notional_limit_micro === null ? null : BigInt(row.notional_limit_micro),
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
    for (const p of user.actAs) builder.addFact(fact`act_as(${p})`);
    if (user.service) builder.addFact(fact`service(true)`);
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
    const actAs = q(rule`q($p) <- act_as($p)`);
    const limit = Number(limits[0] ?? -1);
    return {
      email: String(emails[0] ?? "service"),
      role: (roles[0] ?? "viewer") as Role,
      actAs: actAs.map(String),
      limitMicro: limit < 0 ? null : BigInt(limit),
    };
  }
}
