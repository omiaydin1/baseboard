import { parseEther } from "viem";
import { base, celo } from "wagmi/chains";

/** Width / height of the square grid (3162 x 3162 = 9,998,244 plots). */
export const GRID_SIZE = 3162;

/** Number of treatable plots on the grid. */
export const TOTAL_PLOTS = GRID_SIZE * GRID_SIZE; // 9,998,244

/** Marketing figure shown in the UI ("10 million plots"). */
export const DISPLAY_MAX_PLOTS = 10_000_000;

/** Flat primary price per plot, as a decimal-ETH string. */
export const PLOT_PRICE_ETH = "0.00005";

/** Flat primary price per plot, in wei. */
export const PLOT_PRICE_WEI = parseEther(PLOT_PRICE_ETH);

/** Treasury that receives 100% of primary purchase proceeds. */
export const TREASURY_ADDRESS =
  "0xce835359202acbB4a10d9a2f97a72E6d0B76f1e2" as const;

/** Target chain — Base Mainnet. */
export const TARGET_CHAIN = base;
export const TARGET_CHAIN_ID = base.id; // 8453

/**
 * Dev-only local-chain mode. When `NEXT_PUBLIC_DEV_LOCAL=1` the app points at a
 * local Hardhat node (chain 31337) so the full wallet/upload flow can be tested
 * without spending real ETH. It is a complete no-op in production.
 */
export const DEV_LOCAL = process.env.NEXT_PUBLIC_DEV_LOCAL === "1";
export const LOCAL_CHAIN_ID = 31337;

/** Chain id the app actively targets (local node in dev-local mode). */
export const ACTIVE_CHAIN_ID = DEV_LOCAL ? LOCAL_CHAIN_ID : TARGET_CHAIN_ID;

/**
 * Deployed BaseBoard contract address. Configure via
 * `NEXT_PUBLIC_BASEBOARD_CONTRACT_ADDRESS`. Falls back to the zero address,
 * in which case the UI runs in "not deployed" mode (reads are skipped).
 */
export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_BASEBOARD_CONTRACT_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as `0x${string}`;

/**
 * Block the BaseBoard contract was deployed at. Used as the `fromBlock` when
 * scanning `PlotsPurchased` logs to enumerate every minted plot (so owned /
 * for-sale plots can be drawn at any zoom level). Override per-deployment via
 * `NEXT_PUBLIC_BASEBOARD_DEPLOY_BLOCK`.
 */
export const BASEBOARD_DEPLOY_BLOCK = DEV_LOCAL
  ? 0
  : Number(process.env.NEXT_PUBLIC_BASEBOARD_DEPLOY_BLOCK || "47083347");

/** Whether a real contract address has been configured. */
export const IS_CONTRACT_CONFIGURED =
  CONTRACT_ADDRESS.toLowerCase() !== ZERO_ADDRESS.toLowerCase();

/** OnchainKit / CDP client API key (optional but recommended). */
export const ONCHAINKIT_API_KEY =
  process.env.NEXT_PUBLIC_ONCHAINKIT_API_KEY || "";

/** WalletConnect project id (optional). */
export const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

/** Public origin of the deployed app, used for absolute asset/metadata URLs. */
export const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://base-board-pixel.vercel.app"
).replace(/\/+$/, "");

/**
 * Cache-buster appended to every icon URL. Bump this whenever the logo asset
 * changes so aggressive caches (notably the BaseApp / Coinbase Wallet in-app
 * browser) treat it as a brand-new file and re-fetch our branding.
 */
export const ICON_VERSION = "2";
export const ICON_CACHE_BUST = `?v=${ICON_VERSION}`;

/**
 * Absolute URL to the custom BaseBoard "B" logo (Görsel 5). Used for every
 * dApp / wallet metadata icon (Coinbase Wallet `appLogoUrl`, WalletConnect
 * `metadata.icons`). A full absolute URL (not a relative `/icon.png`) is
 * required because BaseApp fails to resolve relative icon paths.
 */
export const APP_LOGO_URL = `${APP_URL}/icon.png${ICON_CACHE_BUST}`;

// ---------------------------------------------------------------------------
// Multi-chain configuration (Base + Celo)
// ---------------------------------------------------------------------------
// BaseBoard runs concurrently on Base Mainnet (8453) and Celo Mainnet (42220).
// Every read/write resolves its contract address, mint price, treasury and
// log-scan deploy block from the *active* chain via `getChainConfig(chainId)`,
// so switching networks transparently isolates state to that chain. Base's
// shipped behaviour is untouched — its config below mirrors the original
// constants exactly.

export const BASE_CHAIN_ID = base.id; // 8453
export const CELO_CHAIN_ID = celo.id; // 42220

/**
 * Celo Mainnet BaseBoard — live contract deployed at block 69652905
 * (price 1.3 CELO, treasury 0x71aad…812b). Override via env if redeployed.
 */
export const CELO_CONTRACT_ADDRESS = (process.env
  .NEXT_PUBLIC_CELO_CONTRACT_ADDRESS ||
  "0x7b5E66cD88305aB33CE2c2C400167B7fFF348a23") as `0x${string}`;

/**
 * Treasury that receives Celo mint fees. The real routing lives *inside* the
 * deployed contract; this constant is for the frontend (display / parity) and
 * should match the `TREASURY` baked into the Celo deployment.
 */
export const CELO_TREASURY_ADDRESS = (process.env
  .NEXT_PUBLIC_CELO_TREASURY_ADDRESS ||
  "0x71aad1110dfd8f60249cd45ce4fb05163b6f812b") as `0x${string}`;

/**
 * Flat primary price per plot on Celo, as a decimal-CELO string. Fixed at
 * 1.3 CELO per plot (the ~0.1 USDC token equivalent at current rates).
 * Override via `NEXT_PUBLIC_CELO_PLOT_PRICE` if the CELO/USD rate shifts.
 */
export const CELO_PLOT_PRICE = process.env.NEXT_PUBLIC_CELO_PLOT_PRICE || "1.3";
export const CELO_PLOT_PRICE_WEI = parseEther(CELO_PLOT_PRICE);

/** Block the Celo BaseBoard was deployed at (used as the log-scan floor). */
export const CELO_DEPLOY_BLOCK = Number(
  process.env.NEXT_PUBLIC_CELO_DEPLOY_BLOCK || "69652905",
);

/**
 * Optional ENS-compatible universal resolver for Celo Name Service (.celo)
 * reverse lookups. Celo has no single canonical public reverse registry, so
 * this is env-driven: when an address is provided, a connected Celo account is
 * resolved to its human-readable name; otherwise the UI falls back to the short
 * hex address. (Base basenames resolve out of the box via OnchainKit.)
 */
export const CELO_NAME_UNIVERSAL_RESOLVER = (process.env
  .NEXT_PUBLIC_CELO_NAME_RESOLVER || "") as string;

/** Per-chain configuration consumed everywhere reads/writes happen. */
export interface ChainConfig {
  chainId: number;
  /** Display name (e.g. "Base Mainnet"). */
  name: string;
  /** Short label shown in the switcher (e.g. "Base"). */
  shortName: string;
  /** Deployed BaseBoard contract for this chain. */
  contract: `0x${string}`;
  /** Whether a non-zero contract address is configured. */
  isConfigured: boolean;
  /** Flat primary price per plot, in wei (native units). */
  plotPriceWei: bigint;
  /** Decimal price string for display. */
  plotPriceLabel: string;
  /** Native currency symbol (ETH / CELO). */
  nativeSymbol: string;
  /** Treasury receiving mint fees (on-chain authoritative). */
  treasury: `0x${string}`;
  /** Block to start `PlotsPurchased` log scans from. */
  deployBlock: number;
  /** Default RPC url (for wallet_addEthereumChain). */
  rpcUrl: string;
  /** Block explorer base url. */
  explorer: string;
}

const isNonZero = (addr: string) =>
  addr.toLowerCase() !== ZERO_ADDRESS.toLowerCase();

const BASE_CONFIG: ChainConfig = {
  chainId: BASE_CHAIN_ID,
  name: "Base Mainnet",
  shortName: "Base",
  contract: CONTRACT_ADDRESS,
  isConfigured: isNonZero(CONTRACT_ADDRESS),
  plotPriceWei: PLOT_PRICE_WEI,
  plotPriceLabel: PLOT_PRICE_ETH,
  nativeSymbol: "ETH",
  treasury: TREASURY_ADDRESS,
  deployBlock: BASEBOARD_DEPLOY_BLOCK,
  rpcUrl: "https://mainnet.base.org",
  explorer: "https://basescan.org",
};

const CELO_CONFIG: ChainConfig = {
  chainId: CELO_CHAIN_ID,
  name: "Celo Mainnet",
  shortName: "Celo",
  contract: CELO_CONTRACT_ADDRESS,
  isConfigured: isNonZero(CELO_CONTRACT_ADDRESS),
  plotPriceWei: CELO_PLOT_PRICE_WEI,
  plotPriceLabel: CELO_PLOT_PRICE,
  nativeSymbol: "CELO",
  treasury: CELO_TREASURY_ADDRESS,
  deployBlock: CELO_DEPLOY_BLOCK,
  rpcUrl: "https://forno.celo.org",
  explorer: "https://celoscan.io",
};

const LOCAL_CONFIG: ChainConfig = {
  chainId: LOCAL_CHAIN_ID,
  name: "Local Hardhat",
  shortName: "Local",
  contract: CONTRACT_ADDRESS,
  isConfigured: isNonZero(CONTRACT_ADDRESS),
  plotPriceWei: PLOT_PRICE_WEI,
  plotPriceLabel: PLOT_PRICE_ETH,
  nativeSymbol: "ETH",
  treasury: TREASURY_ADDRESS,
  deployBlock: 0,
  rpcUrl: "http://127.0.0.1:8545",
  explorer: "",
};

/** All chains the app supports in the current mode. */
export const CHAIN_CONFIGS: ChainConfig[] = DEV_LOCAL
  ? [LOCAL_CONFIG]
  : [BASE_CONFIG, CELO_CONFIG];

/** Chain shown / targeted when disconnected or on an unsupported network. */
export const DEFAULT_CHAIN_CONFIG: ChainConfig = CHAIN_CONFIGS[0];

export const SUPPORTED_CHAIN_IDS = CHAIN_CONFIGS.map((c) => c.chainId);

/** Resolve the config for a chain id, or `undefined` if unsupported. */
export function getChainConfig(chainId?: number): ChainConfig | undefined {
  if (chainId == null) return undefined;
  return CHAIN_CONFIGS.find((c) => c.chainId === chainId);
}
