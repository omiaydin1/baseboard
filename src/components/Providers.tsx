"use client";

import { ReactNode, useState } from "react";
import { OnchainKitProvider } from "@coinbase/onchainkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { base } from "wagmi/chains";
import { getWagmiConfig } from "@/lib/wagmi";
import { ONCHAINKIT_API_KEY } from "@/lib/constants";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * Wraps the app in the three providers OnchainKit requires, in order:
 * WagmiProvider -> QueryClientProvider -> OnchainKitProvider.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [config] = useState(() => getWagmiConfig());
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <OnchainKitProvider
          apiKey={ONCHAINKIT_API_KEY || undefined}
          chain={base}
          config={{
            appearance: {
              name: "BaseBoard",
              mode: "light",
              theme: "default",
            },
            wallet: {
              display: "modal",
            },
          }}
        >
          <ErrorBoundary>{children}</ErrorBoundary>
        </OnchainKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
