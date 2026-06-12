// Counterparty directory = ENS on Sepolia (I4). Whitelisting resolves the org's
// aragorn.* text records via viem's UniversalResolver (works for v1 and v2 entries).
import { createPublicClient, http, type PublicClient } from "viem";
import { sepolia } from "viem/chains";
import type { Sql } from "./db.ts";

export interface ResolvedOrg {
  ensName: string;
  encPubkey: string;
  endpoint: string;
  partyRoot: string;
  modules?: string;
}

export class EnsDirectory {
  private client: PublicClient | undefined;

  constructor(sepoliaRpcUrl: string | undefined, private sql: Sql) {
    if (sepoliaRpcUrl) {
      this.client = createPublicClient({ chain: sepolia, transport: http(sepoliaRpcUrl) });
    }
  }

  get enabled(): boolean {
    return !!this.client;
  }

  /** Live Sepolia resolution of an org's records. */
  async resolve(ensName: string): Promise<ResolvedOrg> {
    if (!this.client) throw new Error("SEPOLIA_RPC_URL not configured");
    const [encPubkey, endpoint, partyRoot, modules] = await Promise.all([
      this.client.getEnsText({ name: ensName, key: "aragorn.encpubkey" }),
      this.client.getEnsText({ name: ensName, key: "aragorn.endpoint" }),
      this.client.getEnsText({ name: ensName, key: "aragorn.partyroot" }),
      this.client.getEnsText({ name: ensName, key: "aragorn.modules" }),
    ]);
    if (!encPubkey || !partyRoot) {
      throw new Error(`${ensName} is not an Aragorn ring (missing aragorn.* records)`);
    }
    return { ensName, encPubkey, endpoint: endpoint ?? "", partyRoot, modules: modules ?? "" };
  }

  /** Whitelist an org by name: resolve now, persist the resolution. */
  async whitelist(ensName: string): Promise<ResolvedOrg> {
    const resolved = await this.resolve(ensName);
    await this.sql`
      INSERT INTO ens_whitelist (ens_name, resolved_encpubkey, resolved_endpoint, resolved_partyroot, resolved_modules, resolved_at, status)
      VALUES (${ensName}, ${resolved.encPubkey}, ${resolved.endpoint}, ${resolved.partyRoot}, ${resolved.modules ?? ""}, now(), 'active')
      ON CONFLICT (ens_name) DO UPDATE
        SET resolved_encpubkey = ${resolved.encPubkey},
            resolved_endpoint = ${resolved.endpoint},
            resolved_partyroot = ${resolved.partyRoot},
            resolved_modules = ${resolved.modules ?? ""},
            resolved_at = now(),
            status = 'active'`;
    return resolved;
  }

  /** Whitelist-gated lookup used by the transfer flow for ENS-named counterparties. */
  async lookupWhitelisted(ensName: string): Promise<ResolvedOrg> {
    const [row] = await this.sql`
      SELECT * FROM ens_whitelist WHERE ens_name = ${ensName} AND status = 'active'`;
    if (!row) throw new Error(`${ensName} is not whitelisted — add it in Admin first`);
    return {
      ensName,
      encPubkey: row.resolved_encpubkey,
      endpoint: row.resolved_endpoint ?? "",
      partyRoot: row.resolved_partyroot,
    };
  }

  async list(): Promise<unknown[]> {
    return this.sql`SELECT * FROM ens_whitelist ORDER BY ens_name`;
  }

  /** ENSv2 metadata layer: departments are resolvable entities. For
   *  "treasury.ubs.aragornrings.eth", the party key lives ON ENS (aragorn.partykey),
   *  whitelist-gated by the org suffix. */
  async resolveDepartment(name: string): Promise<{ partyKey: string; encPubkey: string }> {
    if (!this.client) throw new Error("SEPOLIA_RPC_URL not configured");
    const orgName = name.split(".").slice(1).join(".");
    const org = await this.lookupWhitelisted(orgName);
    const partyKey = await this.client.getEnsText({ name, key: "aragorn.partykey" });
    if (!partyKey) throw new Error(`${name} has no aragorn.partykey record`);
    return { partyKey, encPubkey: org.encPubkey };
  }
}
