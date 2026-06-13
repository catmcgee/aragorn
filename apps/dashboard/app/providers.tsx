"use client";

import { PrivyProvider } from "@privy-io/react-auth";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function privyConfigured(): boolean {
  return Boolean(appId);
}

export default function Providers({ children }: { children: React.ReactNode }) {
  // Without an app id the PrivyProvider throws; fall back to the dev-token path.
  if (!appId) return <>{children}</>;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "dark" },
        // Privy v3 nests createOnLogin per chain family.
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
