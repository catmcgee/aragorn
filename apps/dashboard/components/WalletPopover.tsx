"use client";

// Privy embedded-wallet panel for the sidebar footer. This component calls Privy
// hooks (useWallets / useFundWallet) so it must ONLY be mounted when a PrivyProvider
// is present — i.e. when NEXT_PUBLIC_PRIVY_APP_ID is set. The dev-token path renders
// a plain message instead (see AppShell).

import { useEffect, useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import { createPublicClient, http, formatUnits, type Address, type Chain } from "viem";
import { base, mainnet } from "viem/chains";

type ChainKey = "ethereum" | "base";

// Per-chain config — the same embedded-wallet address holds balances on every EVM chain.
const CHAINS: Record<ChainKey, { chain: Chain; usdc: Address; label: string }> = {
  ethereum: { chain: mainnet, usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", label: "Ethereum" },
  base: { chain: base, usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", label: "Base" },
};
const ERC20_BALANCE_OF = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

interface ChainBalance {
  eth: string;
  usdc: string;
}

export default function WalletPopover({ onClose }: { onClose: () => void }) {
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const address = embedded?.address as Address | undefined;

  const [balances, setBalances] = useState<Record<ChainKey, ChainBalance> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    let live = true;
    setLoading(true);
    setBalances(null);
    const read = async (key: ChainKey): Promise<ChainBalance> => {
      try {
        const { chain, usdc } = CHAINS[key];
        const client = createPublicClient({ chain, transport: http() });
        const [wei, raw] = await Promise.all([
          client.getBalance({ address }),
          client.readContract({
            address: usdc,
            abi: ERC20_BALANCE_OF,
            functionName: "balanceOf",
            args: [address],
          }) as Promise<bigint>,
        ]);
        return { eth: Number(formatUnits(wei, 18)).toFixed(4), usdc: Number(formatUnits(raw, 6)).toFixed(2) };
      } catch {
        return { eth: "—", usdc: "—" };
      }
    };
    (async () => {
      const [ethereum, baseBal] = await Promise.all([read("ethereum"), read("base")]);
      if (!live) return;
      setBalances({ ethereum, base: baseBal });
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [address]);

  return (
    <div className="space-y-3">
      {!address ? (
        <p className="text-[12px] text-ink-5">
          No embedded wallet yet — it is created on first sign-in.
        </p>
      ) : (
        <>
          <div>
            <div className="mb-1 text-[10px] tracking-[0.14em] text-ink-6 uppercase">
              Embedded wallet
            </div>
            <a
              href={`https://basescan.org/address/${address}`}
              target="_blank"
              rel="noreferrer"
              className="chip font-mono"
              title="View on Basescan"
            >
              {address.slice(0, 6)}…{address.slice(-4)}
              <span className="ml-1 text-steel">↗</span>
            </a>
          </div>

          <div>
            <div className="mb-1.5 text-[10px] tracking-[0.14em] text-ink-6 uppercase">
              Balances
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {(["ethereum", "base"] as ChainKey[]).map((chain) => (
                <div key={chain} className="rounded-lg border border-line-soft bg-ground px-3 py-2.5">
                  <div className="mb-1.5 text-[11px] font-medium text-ink-3">{CHAINS[chain].label}</div>
                  {loading ? (
                    <p className="text-[12px] text-ink-5">…</p>
                  ) : (
                    <dl className="space-y-1 text-[13px]">
                      <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-[10px] text-ink-6">ETH</dt>
                        <dd className="tabular-nums text-ink">{balances?.[chain]?.eth ?? "—"}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-[10px] text-ink-6">USDC</dt>
                        <dd className="tabular-nums text-ink">{balances?.[chain]?.usdc ?? "—"}</dd>
                      </div>
                    </dl>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
