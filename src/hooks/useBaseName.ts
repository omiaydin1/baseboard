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

// ---------------------------------------------------------------------------
// Basenames L2 resolver on Base Mainnet
// ---------------------------------------------------------------------------

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
 * Basenames L2 resolver expects the node computed from the ASCII hash of the
 * hex address string (NOT the raw 20-byte hash). OnchainKit uses the same
 * approach internally via keccak256(addressFormatted.substring(2)).
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
  expiresAt: number;
  failures: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RETRY_DELAY = 60_000;

const nameCache = new Map<string, CacheEntry>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function getBaseClient() {
  return createPublicClient({
    chain: base,
    transport: http("https://mainnet.base.org", { timeout: 10_000 }),
  });
}

let sharedClient: ReturnType<typeof getBaseClient> | null = null;
function client() {
  if (!sharedClient) sharedClient = getBaseClient();
  return sharedClient;
}

function scheduleRetry(key: string, entry: CacheEntry) {
  const delay = Math.min(1_000 * 2 ** entry.failures, MAX_RETRY_DELAY);
  setTimeout(() => ensureResolved(key), delay);
}

function ensureResolved(key: string) {
  if (inflight.has(key)) return;

  const existing = nameCache.get(key);
  if (existing && existing.expiresAt > Date.now()) return;

  inflight.add(key);
  client()
    .readContract({
      address: BASENAME_L2_RESOLVER,
      abi: L2_RESOLVER_ABI,
      functionName: "name",
      args: [reverseNode(key as Address, base.id)],
    })
    .then((resolved) => {
      nameCache.set(key, {
        name: resolved && resolved.length > 0 ? resolved : null,
        expiresAt: Date.now() + CACHE_TTL_MS,
        failures: 0,
      });
    })
    .catch(() => {
      const prev = nameCache.get(key);
      const failures = (prev?.failures ?? 0) + 1;
      nameCache.set(key, {
        name: prev?.name ?? null,
        expiresAt: Date.now() + Math.min(CACHE_TTL_MS, 30_000),
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
 * Seed the shared name cache with known basenames (e.g. from Turso API).
 */
export function seedNameCache(entries: Record<string, string | null>): void {
  const ttl = 30 * 60 * 1000;
  const now = Date.now();
  for (const [addr, name] of Object.entries(entries)) {
    const key = addr.toLowerCase();
    const existing = nameCache.get(key);
    if (!existing || existing.expiresAt < now + ttl) {
      nameCache.set(key, {
        name,
        expiresAt: now + ttl,
        failures: 0,
      });
    }
  }
  emit();
}

/**
 * Resolve a wallet to its Basename (e.g. `omiaydin.base.eth`) by reading the
 * official Basenames L2 resolver directly on Base Mainnet.
 *
 * - Cache'lenmis deger varsa (Turso'dan seed) direkt doner, RPC cagrisi olmaz.
 * - Yoksa public RPC (mainnet.base.org) ile cozer, yavas olabilir.
 * - Basariz olursa exponential backoff ile tekrar dener.
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
