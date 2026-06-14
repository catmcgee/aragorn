// Ring node configuration (BUILD_SPEC §9). One process per institution.
import { hexToField, type Field } from "@aragorn/protocol";

export interface DirectoryEntry {
  /** org x25519 encryption pubkey, hex 32B */
  encPubkey: string;
  /** party label → grumpkin pubkey x (hex) */
  parties: Record<string, string>;
}

export interface RingConfig {
  orgName: string;
  port: number;
  databaseUrl: string;
  rpcUrl: string;
  registryAddr: `0x${string}`;
  usdcAddr: `0x${string}`;
  vaultAddr: `0x${string}`;
  relayerUrl: string;
  relayerToken: string;
  apiToken: string;
  /** org X25519 private key, hex 32B */
  encPrivKey: Uint8Array;
  /** party label → grumpkin private key (field) */
  partyKeys: Record<string, Field>;
  fundingEoaKey: `0x${string}`;
  /** static directory for P2; replaced by ENS resolution in P3 */
  directory: Record<string, DirectoryEntry>;
  privyAppId?: string;
  privyAppSecret?: string;
  biscuitRootPriv?: string;
  emailDomainAllowlist: string[];
  sepoliaRpcUrl?: string;
  /** the Ring's OWN ENS name — its onchain identity (ENS v2 proposal #3) */
  ringEns?: string;
  enabledModules: string[];
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export function loadConfig(): RingConfig {
  const partyKeys: Record<string, Field> = {};
  for (const [label, k] of Object.entries(JSON.parse(req("PARTY_KEYS")) as Record<string, string>)) {
    partyKeys[label] = hexToField(k);
  }
  return {
    orgName: req("RING_ORG_NAME"),
    port: Number(process.env.PORT ?? 4001),
    databaseUrl: req("DATABASE_URL"),
    rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
    registryAddr: req("NOTE_REGISTRY_ADDR") as `0x${string}`,
    usdcAddr: req("USDC_ADDR") as `0x${string}`,
    vaultAddr: req("SHIELD_VAULT_ADDR") as `0x${string}`,
    relayerUrl: process.env.RELAYER_URL ?? "http://127.0.0.1:4900",
    relayerToken: req("RELAYER_TOKEN"),
    apiToken: req("API_TOKEN"),
    encPrivKey: Buffer.from(req("ORG_ENC_PRIV").replace("0x", ""), "hex"),
    partyKeys,
    fundingEoaKey: req("FUNDING_EOA_PRIVATE_KEY") as `0x${string}`,
    directory: JSON.parse(process.env.DIRECTORY ?? "{}"),
    privyAppId: process.env.PRIVY_APP_ID,
    privyAppSecret: process.env.PRIVY_APP_SECRET,
    biscuitRootPriv: process.env.BISCUIT_ROOT_PRIV,
    emailDomainAllowlist: (process.env.EMAIL_DOMAIN_ALLOWLIST ?? "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
    sepoliaRpcUrl: process.env.SEPOLIA_RPC_URL,
    ringEns: process.env.RING_ENS,
    enabledModules: (process.env.ENABLED_MODULES ?? "payments,repo,payroll,issuance,strategies")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean),
  };
}
