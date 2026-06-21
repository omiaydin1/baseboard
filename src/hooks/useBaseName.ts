"use client";

import { useEffect, useState } from "react";
import {
  createPublicClient,
  encodePacked,
  http,
  isAddress,
  keccak256,
  namehash,
  toHex,
  type Address,
} from "viem";
import { base } from "viem/chains";
import { BASE_CHAIN_ID, getChainConfig } from "@/lib/constants";

/**
 * Official Basenames L2 resolver on Base Mainnet. Reverse records for
 * `*.base.eth` names registered via https://www.base.org/names live here.
 */
const BASENAME_L2_RESOLVER: Address =
  "0xC6d566A56A1aFf6508b41f6c90ff131615583BCD";

const L2_RESOLVER_ABI = [
  {
    inputs: [{ name: "node", type: "bytes32" }],
    name: "name",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/** ENSIP-11 coin type for an EVM chain: (0x80000000 | chainId), as upper hex. */
function chainCoinType(chainId: number): string {
  return ((0x80000000 | chainId) >>> 0).toString(16).toUpperCase();
}

/**
 * Compute the reverse-resolution node for `address` on the given chain:
 * `namehash(keccak(addr) . namehash("<COINTYPE>.reverse"))`. Mirrors the
 * standard Basenames/ENSIP-11 reverse node derivation.
 */
function reverseNode(address: Address, chainId: number): `0x${string}` {
  const addrLabel = keccak256(toHex(address.toLowerCase().slice(2)));
  const baseReverse = namehash(`${chainCoinType(chainId)}.reverse`);
  return keccak256(
    encodePacked(["bytes32", "bytes32"], [baseReverse, addrLabel]),
  );
}

/**
 * Resolve a connected wallet to its Basename (e.g. `omiaydin.base.eth`) by
 * reading the official Base Name registry's L2 resolver directly, instead of
 * relying on the OnchainKit wrapper. Returns null while loading or when the
 * address has no Basename, so callers fall back to the short hex address.
 */
export function useBaseName(address?: Address): string | null {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    setName(null);
    if (!address || !isAddress(address)) return;

    let cancelled = false;
    const rpcUrl =
      getChainConfig(BASE_CHAIN_ID)?.rpcUrl ?? "https://mainnet.base.org";
    const client = createPublicClient({ chain: base, transport: http(rpcUrl) });

    client
      .readContract({
        address: BASENAME_L2_RESOLVER,
        abi: L2_RESOLVER_ABI,
        functionName: "name",
        args: [reverseNode(address, BASE_CHAIN_ID)],
      })
      .then((resolved) => {
        if (!cancelled) setName(resolved && resolved.length > 0 ? resolved : null);
      })
      .catch(() => {
        if (!cancelled) setName(null);
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  return name;
}
