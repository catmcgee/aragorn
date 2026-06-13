"use client";

// Privy embedded-wallet panel for the sidebar footer. This component calls Privy
// hooks (useWallets / useFundWallet) so it must ONLY be mounted when a PrivyProvider
// is present — i.e. when NEXT_PUBLIC_PRIVY_APP_ID is set. The dev-token path renders
// a plain message instead (see AppShell).

import { useEffect, useState } from "react";
import { useWallets, useFundWallet } from "@privy-io/react-auth";
import { createPublicClient, http, formatUnits, type Address } from "viem";
import { base } from "viem/chains";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const ERC20_BALANCE_OF = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const baseClient = createPublicClient({ chain: base, transport: http() });

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

interface Balances {
  eth: string;
  usdc: string;
  empty: boolean;
}

export default function WalletPopover({ onClose }: { onClose: () => void }) {
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const address = embedded?.address as Address | undefined;

  const [copied, setCopied] = useState(false);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [loading, setLoading] = useState(false);

  // Privy's useFundWallet may not exist on every version — guard defensively so the
  // build/runtime never breaks if it's absent.
  let fundWallet: ((args: { address: string }) => Promise<unknown>) | null = null;
  try {
    const fw = useFundWallet();
    if (fw && typeof fw.fundWallet === "function") fundWallet = fw.fundWallet;
  } catch {
    fundWallet = null;
  }

  useEffect(() => {
    if (!address) return;
    let live = true;
    setLoading(true);
    setBalances(null);
    (async () => {
      try {
        const [wei, raw] = await Promise.all([
          baseClient.getBalance({ address }),
          baseClient.readContract({
            address: USDC_BASE,
            abi: ERC20_BALANCE_OF,
            functionName: "balanceOf",
            args: [address],
          }) as Promise<bigint>,
        ]);
        if (!live) return;
        const eth = Number(formatUnits(wei, 18));
        const usdc = Number(formatUnits(raw, 6));
        setBalances({
          eth: eth.toFixed(4),
          usdc: usdc.toFixed(2),
          empty: wei === 0n && raw === 0n,
        });
      } catch {
        if (live) setBalances({ eth: "—", usdc: "—", empty: false });
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [address]);

  function copy() {
    if (!address) return;
    navigator.clipboard?.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  }

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
            <button className="chip" onClick={copy} title="Click to copy address">
              {shortAddr(address)}
              <span className="text-ink-6">{copied ? "copied" : "copy"}</span>
            </button>
          </div>

          <div>
            <div className="mb-1 text-[10px] tracking-[0.14em] text-ink-6 uppercase">
              Balance · Base
            </div>
            {loading ? (
              <p className="text-[12px] text-ink-5">—</p>
            ) : balances?.empty ? (
              <p className="text-[12px] text-ink-5">No funds on Base yet</p>
            ) : (
              <dl className="grid grid-cols-2 gap-2 text-[13px]">
                <div>
                  <dt className="text-[10px] text-ink-6">ETH</dt>
                  <dd className="tabular-nums text-ink">{balances?.eth ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-ink-6">USDC</dt>
                  <dd className="tabular-nums text-ink">{balances?.usdc ?? "—"}</dd>
                </div>
              </dl>
            )}
          </div>

          <div className="flex gap-2">
            <button className="btn flex-1" onClick={copy}>
              Copy address
            </button>
            {fundWallet && (
              <button
                className="btn-primary flex-1"
                onClick={() => fundWallet!({ address }).catch(() => {})}
              >
                Fund wallet
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
