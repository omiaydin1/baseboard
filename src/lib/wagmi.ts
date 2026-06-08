import { http, createConfig, createStorage, cookieStorage } from "wagmi";
import { base } from "wagmi/chains";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { WALLETCONNECT_PROJECT_ID } from "./constants";

/**
 * wagmi config restricted to Base Mainnet (8453). Supports Coinbase Wallet,
 * MetaMask / injected wallets, and (optionally) WalletConnect.
 */
export function getWagmiConfig() {
  const connectors = [
    coinbaseWallet({
      appName: "BaseBoard",
      preference: "all",
    }),
    injected({ shimDisconnect: true }),
    ...(WALLETCONNECT_PROJECT_ID
      ? [
          walletConnect({
            projectId: WALLETCONNECT_PROJECT_ID,
            showQrModal: true,
          }),
        ]
      : []),
  ];

  return createConfig({
    chains: [base],
    connectors,
    storage: createStorage({ storage: cookieStorage }),
    ssr: true,
    transports: {
      [base.id]: http(),
    },
  });
}

export type WagmiConfig = ReturnType<typeof getWagmiConfig>;

declare module "wagmi" {
  interface Register {
    config: WagmiConfig;
  }
}
