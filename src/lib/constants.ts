import { parseEther } from "viem";
import { base } from "wagmi/chains";

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
// Chain configuration (Base Mainnet)
// ---------------------------------------------------------------------------
// Every read/write resolves its contract address, mint price, treasury and
// log-scan deploy block from the active chain via `getChainConfig(chainId)`.

export const BASE_CHAIN_ID = base.id; // 8453

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
  /** Native currency symbol (ETH). */
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
  : [BASE_CONFIG];

/** Chain shown / targeted when disconnected or on an unsupported network. */
export const DEFAULT_CHAIN_CONFIG: ChainConfig = CHAIN_CONFIGS[0];

export const SUPPORTED_CHAIN_IDS = CHAIN_CONFIGS.map((c) => c.chainId);

/** Resolve the config for a chain id, or `undefined` if unsupported. */
export function getChainConfig(chainId?: number): ChainConfig | undefined {
  if (chainId == null) return undefined;
  return CHAIN_CONFIGS.find((c) => c.chainId === chainId);
}
