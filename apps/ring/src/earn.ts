// Privy Earn (B2, D-004): the PUBLIC treasury buffer earns via Morpho vaults on Base —
// real chain, real yield, through Privy's server-wallet Earn API. The private-strategies
// card next to this in the UI is greyed roadmap (B1 cut).
import type { Sql } from "./db.ts";

const PRIVY_API = "https://api.privy.io";

export class EarnService {
  private headers: Record<string, string>;

  constructor(
    private appId: string | undefined,
    appSecret: string | undefined,
    private walletId: string | undefined,
    private vaultId: string | undefined,
  ) {
    this.headers = {
      "content-type": "application/json",
      "privy-app-id": appId ?? "",
      authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
    };
  }

  get enabled(): boolean {
    return !!(this.appId && this.walletId && this.vaultId);
  }

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${PRIVY_API}${path}`, {
      method,
      headers: this.headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`privy ${path}: ${JSON.stringify(json).slice(0, 200)}`);
    return json;
  }

  /** amount in USDC base units (6dp) — Earn takes raw_amount. */
  deposit(amountMicro: bigint): Promise<any> {
    return this.call("POST", `/api/v1/wallets/${this.walletId}/earn/ethereum/deposit`, {
      vault_id: this.vaultId,
      raw_amount: amountMicro.toString(),
    });
  }

  withdraw(amountMicro: bigint): Promise<any> {
    return this.call("POST", `/api/v1/wallets/${this.walletId}/earn/ethereum/withdraw`, {
      vault_id: this.vaultId,
      raw_amount: amountMicro.toString(),
    });
  }

  async status(): Promise<{
    enabled: boolean;
    position?: { assetsInVault: string; totalDeposited: string; earnedYield: string };
    vault?: { apyBps: number; provider: string; tvlUsd: number };
  }> {
    if (!this.enabled) return { enabled: false };
    const [pos, vault] = await Promise.all([
      this.call("GET", `/api/v1/wallets/${this.walletId}/earn/ethereum/vaults?vault_id=${this.vaultId}`),
      this.call("GET", `/v1/earn/ethereum/vaults/${this.vaultId}`),
    ]);
    const p = Array.isArray(pos?.vaults) ? pos.vaults[0] : (pos?.vaults ?? pos);
    const deposited = BigInt(p?.total_deposited ?? 0);
    const withdrawn = BigInt(p?.total_withdrawn ?? 0);
    const inVault = BigInt(p?.assets_in_vault ?? 0);
    return {
      enabled: true,
      position: {
        assetsInVault: inVault.toString(),
        totalDeposited: deposited.toString(),
        earnedYield: (inVault - (deposited - withdrawn)).toString(),
      },
      vault: {
        apyBps: Number(vault?.user_apy ?? 0),
        provider: vault?.provider ?? "morpho",
        tvlUsd: Number(vault?.tvl_usd ?? 0),
      },
    };
  }
}
