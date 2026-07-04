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

interface CacheEntry {
  name: string | null;
  /** Unix ms when this entry expires — stale entries get retried. */
  expiresAt: number;
  /** Number of consecutive failures so far (for back-off). */
  failures: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRY_DELAY = 60_000; // 1 minute

/** address(lowercase) -> CacheEntry */
const nameCache = new Map<string, CacheEntry>();
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

function scheduleRetry(key: string, entry: CacheEntry) {
  const delay = Math.min(
    1_000 * 2 ** entry.failures,
    MAX_RETRY_DELAY,
  );
  setTimeout(() => ensureResolved(key), delay);
}

function ensureResolved(key: string) {
  if (inflight.has(key)) return;

  const existing = nameCache.get(key);
  if (existing && existing.expiresAt > Date.now()) return;

  inflight.add(key);
  getClient()
    .readContract({
      address: BASENAME_L2_RESOLVER,
      abi: L2_RESOLVER_ABI,
      functionName: "name",
      args: [reverseNode(key as Address, BASE_CHAIN_ID)],
    })
    .then((resolved) => {
      nameCache.set(key, {
        name: resolved && resolved.length > 0 ? resolved : null,
        expiresAt: Date.now() + CACHE_TTL_MS,
        failures: 0,
      });
    })
    .catch(() => {
      // On failure: keep existing entry alive for a bit, or create a
      // short-lived null so the UI doesn't flicker, then retry later.
      const prev = nameCache.get(key);
      const failures = (prev?.failures ?? 0) + 1;
      nameCache.set(key, {
        name: prev?.name ?? null,
        expiresAt: Date.now() + Math.min(CACHE_TTL_MS, 30_000), // short expiry
        failures,
      });
      scheduleRetry(key, nameCache.get(key)!);
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
 *
 * - Entries expire after 5 minutes and are re-resolved on next access.
 * - On RPC error: the previous name (if any) survives; null is cached with a
 *   short TTL, and a background retry is scheduled with exponential back-off.
 */
export function useBaseName(address?: Address): string | null {
  const key =
    address && isAddress(address) ? address.toLowerCase() : null;

  const name = useSyncExternalStore(
    subscribe,
    () => (key ? nameCache.get(key)?.name ?? null : null),
    () => null,
  );

  useEffect(() => {
    if (key) ensureResolved(key);
  }, [key]);

  return name;
}
