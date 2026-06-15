"use client";

import { useChainId } from "wagmi";
import {
  DEFAULT_CHAIN_CONFIG,
  getChainConfig,
  type ChainConfig,
} from "@/lib/constants";

/**
 * Resolve the BaseBoard config (contract address, mint price, treasury, deploy
 * block, native symbol …) for the wallet's currently-active chain. Falls back
 * to the default chain (Base in production) when disconnected or on an
 * unsupported network, so reads/writes always target a coherent contract.
 */
export function useActiveChainConfig(): ChainConfig {
  const chainId = useChainId();
  return getChainConfig(chainId) ?? DEFAULT_CHAIN_CONFIG;
}
