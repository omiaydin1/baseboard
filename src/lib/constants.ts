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
