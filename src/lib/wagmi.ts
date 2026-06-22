import {
  http,
  createConfig,
  createStorage,
  cookieStorage,
  type CreateConnectorFn,
} from "wagmi";
import { base, celo, hardhat } from "wagmi/chains";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { APP_LOGO_URL, APP_URL, DEV_LOCAL, WALLETCONNECT_PROJECT_ID } from "./constants";

const LOCAL_RPC = "http://127.0.0.1:8545";

/**
 * ERC-8021 Base Builder Code attribution suffix for `bc_ztv4rk1x`.
 *
 * viem appends this hex to the end of every transaction's calldata (after the
 * ABI-encoded payload). The EVM ignores trailing calldata, and our contract has
 * no `msg.data` length / raw-decode checks, so this is a safe, purely additive
 * change that credits BaseBoard's onchain volume on base.dev. Decodes to the
 * builder code: `62635f7a747634726b3178` == "bc_ztv4rk1x". Applied to Base only
 * (see `dataSuffix` in `getWagmiConfig`) — Celo transactions are untouched.
 */
export const BASE_BUILDER_CODE = "bc_ztv4rk1x";
export const BASE_DATA_SUFFIX =
  "0x62635f7a747634726b31780b0080218021802180218021802180218021" as const;

/** Stable connector ids so the UI can label / guard each row explicitly. */
export const COINBASE_WALLET_ID = "coinbaseWalletSDK";
export const BASE_WALLET_ID = "baseWallet";

/**
 * A dedicated "Base Wallet" row backed by the Coinbase smart-wallet (Base
 * Account) flow. We wrap the standard Coinbase connector and override its
 * id/name so it appears as its own branded desktop onboarding option distinct
 * from the classic "Coinbase Wallet" row. Both are Coinbase-family connectors
 * and therefore hidden on Celo (which the smart wallet doesn't support).
 */
function baseWalletConnector(): CreateConnectorFn {
  const inner = coinbaseWallet({
    appName: "BaseBoard",
    appLogoUrl: APP_LOGO_URL,
    preference: "smartWalletOnly",
  });
  return (params) => {
    const connector = inner(params);
    return { ...connector, id: BASE_WALLET_ID, name: "Base Wallet" };
  };
}

/**
 * Dev-only: install a minimal EIP-1193 provider on `window.ethereum` that proxies
 * JSON-RPC to a local Hardhat node. Hardhat's accounts are unlocked, so
 * `eth_sendTransaction` is signed by the node — letting the injected connector
 * drive the full buy/list/image flow locally without a real wallet. No-op unless
 * `NEXT_PUBLIC_DEV_LOCAL=1`.
 */
function installLocalProvider() {
  if (!DEV_LOCAL || typeof window === "undefined") return;
  const w = window as unknown as { ethereum?: unknown };
  if (w.ethereum) return;

  const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // hardhat #0
  let rpcId = 0;

  const raw = async (method: string, params: unknown[]) => {
    const res = await fetch(LOCAL_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++rpcId,
        method,
        params: params ?? [],
      }),
    });
    const json = await res.json();
    if (json.error)
      throw Object.assign(new Error(json.error.message), {
        code: json.error.code,
      });
    return json.result;
  };

  const provider = {
    isMetaMask: true,
    request: async ({
      method,
      params,
    }: {
      method: string;
      params?: unknown[];
    }) => {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [ACCOUNT];
        case "eth_chainId":
          return "0x7a69"; // 31337
        case "net_version":
          return "31337";
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
        case "wallet_watchAsset":
          return null;
        default:
          return raw(method, params ?? []);
      }
    },
    on: () => {},
    removeListener: () => {},
  };

  w.ethereum = provider;
}

/**
 * wagmi config for Base Mainnet (8453) + Celo Mainnet (42220), running
 * concurrently. Supports Coinbase Wallet, MetaMask / injected wallets, and
 * (optionally) WalletConnect. Note: Coinbase Smart Wallet does not support
 * Celo — the connect UI hides it while Celo is the active chain.
 */
export function getWagmiConfig() {
  installLocalProvider();

  const connectors = [
    coinbaseWallet({
      appName: "BaseBoard",
      appLogoUrl: APP_LOGO_URL,
      preference: "all",
    }),
    baseWalletConnector(),
    injected({ shimDisconnect: true }),
    ...(WALLETCONNECT_PROJECT_ID
      ? [
          walletConnect({
            projectId: WALLETCONNECT_PROJECT_ID,
            showQrModal: true,
            metadata: {
              name: "BaseBoard",
              description:
                "Buy, sell, trade and draw on a 10-million-plot pixel board on Base Mainnet.",
              url: APP_URL,
              icons: [APP_LOGO_URL],
            },
          }),
        ]
      : []),
  ];

  const shared = {
    connectors,
    storage: createStorage({ storage: cookieStorage }),
    ssr: true,
  };

  if (DEV_LOCAL) {
    return createConfig({
      ...shared,
      chains: [hardhat],
      transports: { [hardhat.id]: http(LOCAL_RPC) },
    });
  }

  return createConfig({
    ...shared,
    chains: [base, celo],
    transports: {
      [base.id]: http(),
      [celo.id]: http(),
    },
    // ERC-8021 attribution applied to the Base client only. The per-chain map
    // form leaves Celo's client without a suffix, so Celo calldata is untouched.
    dataSuffix: {
      [base.id]: BASE_DATA_SUFFIX,
    },
  });
}

export type WagmiConfig = ReturnType<typeof getWagmiConfig>;

declare module "wagmi" {
  interface Register {
    config: WagmiConfig;
  }
}
