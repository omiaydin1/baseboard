// Ambient type declarations for wagmi v2 & @tanstack/react-query (JS-only, no
// bundled .d.ts).  This file must NOT contain top-level imports.

// ------ @tanstack/react-query ------
declare module "@tanstack/react-query" {
  export interface QueryClientConfig {
    defaultOptions?: any;
  }
  export class QueryClient {
    constructor(config?: QueryClientConfig);
  }
  export function QueryClientProvider(props: { client: QueryClient; children: any }): any;
}

// ------ wagmi ------
declare module "wagmi" {
  export interface Config {
    chains: readonly any[];
    client: (config: { chain: any }) => any;
    ssr?: boolean;
    storage?: any;
  }
  export function createConfig(config: any): Config;
  export function http(url?: string, opts?: any): any;
  export function WagmiProvider(props: { config: Config; children: any }): any;
  export function createStorage(config: { storage?: any; key?: string }): any;
  export function cookieStorage(): any;

  export type CreateConnectorFn = any;
  export type Connector = any;

  export function useAccount(): { address?: `0x${string}`; isConnected: boolean; isConnecting: boolean; isReconnecting: boolean; isDisconnected: boolean; connector?: any };
  export function useChainId(): number;
  export function usePublicClient(): any;
  export function useDisconnect(): { disconnect: () => void };
  export function useConnect(): { connect: (args: any) => void; connectors: any[]; isPending: boolean };
  export function useSwitchChain(): { switchChain: (args: { chainId: number }) => void; isPending: boolean };
  export function useWaitForTransactionReceipt(args: { hash?: `0x${string}`; chainId?: number; query?: { enabled?: boolean } }): any;
  export function useWatchContractEvent(args: { address?: `0x${string}`; abi: any; eventName: string; chainId?: number; onLogs: (logs: any[]) => void; pollingInterval?: number; enabled?: boolean }): () => void;
  export function useReadContract(args: { address?: `0x${string}`; abi: any; functionName: string; args?: readonly unknown[]; chainId?: number; query?: { enabled?: boolean; refetchInterval?: number; staleTime?: number; gcTime?: number; refetchOnMount?: string; retry?: number; retryDelay?: number } }): any;
  export function useWriteContract(): { writeContract: (args: any) => void; writeContractAsync: (args: any, options?: any) => Promise<any>; data?: any; isPending?: boolean; error?: any; reset: () => void };

  export type Address = `0x${string}`;
}

declare module "wagmi/chains" {
  export const base: any;
  export const hardhat: any;
}

declare module "wagmi/connectors" {
  export function coinbaseWallet(options?: any): any;
  export function injected(options?: any): any;
  export function walletConnect(options?: any): any;
  export function porto(options?: any): any;
}
