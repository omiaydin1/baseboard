"use client";

import { useEffect, useSyncExternalStore } from "react";
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

// ---------------------------------------------------------------------------
// Shared, deduplicated Basename cache
// ---------------------------------------------------------------------------
// A single process-wide cache + one shared RPC client backs every `useBaseName`
// call. This guarantees the SAME address always renders the SAME identity in
// every surface (header, profile, leaderboard rows, activity ticker) — the
// previous per-component resolution could race so the same wallet showed its
// Basename in one place and a raw address in another. It also collapses the
// leaderboard's many simultaneous row lookups into one request per unique
// address, which keeps resolution off the hot path and avoids RPC throttling.

/** address(lowercase) -> resolved Basename (or null once known to have none). */
const nameCache = new Map<string, string | null>();
/** addresses with an in-flight lookup, so we never fetch the same one twice. */
const inflight = new Set<string>();
/** React subscribers notified whenever a lookup resolves. */
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function createSharedClient() {
  const rpcUrl =
    getChainConfig(BASE_CHAIN_ID)?.rpcUrl ?? "https://mainnet.base.org";
  return createPublicClient({ chain: base, transport: http(rpcUrl) });
}

type SharedClient = ReturnType<typeof createSharedClient>;

let sharedClient: SharedClient | null = null;
function getClient(): SharedClient {
  if (!sharedClient) sharedClient = createSharedClient();
  return sharedClient;
}

function ensureResolved(key: string) {
  if (nameCache.has(key) || inflight.has(key)) return;
  inflight.add(key);
  getClient()
    .readContract({
      address: BASENAME_L2_RESOLVER,
      abi: L2_RESOLVER_ABI,
      functionName: "name",
      args: [reverseNode(key as Address, BASE_CHAIN_ID)],
    })
    .then((resolved) => {
      nameCache.set(key, resolved && resolved.length > 0 ? resolved : null);
    })
    .catch(() => {
      nameCache.set(key, null);
    })
    .finally(() => {
      inflight.delete(key);
      emit();
    });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Resolve a wallet to its Basename (e.g. `omiaydin.base.eth`) via the official
 * Base Name L2 resolver, through a shared cache so the result is consistent
 * everywhere and each address is fetched at most once. Returns null while
 * loading or when the address has no Basename, so callers fall back to the
 * short hex address.
 */
export function useBaseName(address?: Address): string | null {
  const key =
    address && isAddress(address) ? address.toLowerCase() : null;

  const name = useSyncExternalStore(
    subscribe,
    () => (key ? nameCache.get(key) ?? null : null),
    () => null,
  );

  useEffect(() => {
    if (key) ensureResolved(key);
  }, [key]);

  return name;
}
