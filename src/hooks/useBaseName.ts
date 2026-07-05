"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPublicClient, http, isAddress, toCoinType, type Address } from "viem";
import { mainnet, base } from "viem/chains";

// ---------------------------------------------------------------------------
// Shared, deduplicated Basename cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  name: string | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000;

const nameCache = new Map<string, CacheEntry>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

// Dedicated viem client for Basenames resolution on Ethereum mainnet.
// Uses ENSIP-19 cross-chain resolution: the L1Resolver reads state proofs
// from Base to resolve *.base.eth names without a CCIP-read gateway.
let _resolverClient: ReturnType<typeof createPublicClient> | null = null;

function getResolverClient() {
  if (!_resolverClient) {
    _resolverClient = createPublicClient({
      chain: mainnet,
      transport: http("https://eth.merkle.io"),
    });
  }
  return _resolverClient;
}

async function resolveBasename(address: Address): Promise<string | null> {
  try {
    const client = getResolverClient();
    const name = await client.getEnsName({
      address,
      coinType: toCoinType(base.id),
    });
    return name;
  } catch {
    return null;
  }
}

function ensureResolved(key: string) {
  if (inflight.has(key)) return;

  const existing = nameCache.get(key);
  if (existing && existing.expiresAt > Date.now()) return;

  inflight.add(key);

  resolveBasename(key as Address)
    .then((name) => {
      nameCache.set(key, {
        name: name ?? null,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    })
    .catch(() => {
      const prev = nameCache.get(key);
      nameCache.set(key, {
        name: prev?.name ?? null,
        expiresAt: Date.now() + 30_000,
      });
    })
    .finally(() => {
      inflight.delete(key);
      emit();
    });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Seed the shared name cache with known basenames (e.g. from Turso API).
 * Seeds get a longer TTL (30 min) since they come from a trusted indexer.
 */
export function seedNameCache(entries: Record<string, string | null>): void {
  const now = Date.now();
  let changed = false;
  for (const [addr, name] of Object.entries(entries)) {
    const key = addr.toLowerCase();
    const existing = nameCache.get(key);
    if (!existing || existing.expiresAt < now + CACHE_TTL_MS) {
      nameCache.set(key, { name, expiresAt: now + CACHE_TTL_MS });
      changed = true;
    }
  }
  if (changed) emit();
}

/**
 * Batch-resolve basenames for multiple addresses using the Basenames L2
 * Universal Resolver (viem, no OnchainKit dependency). Seeds results into
 * the shared cache so individual `useBaseName` calls hit the cache.
 */
export async function resolveBaseNamesBatch(
  addresses: Address[],
): Promise<Map<string, string | null>> {
  if (addresses.length === 0) return new Map();

  const unique = [...new Set(addresses.map((a) => a.toLowerCase() as Address))];
  const now = Date.now();

  // Check which addresses are already cached with valid entries
  const uncached: Address[] = [];
  for (const addr of unique) {
    const existing = nameCache.get(addr);
    if (!existing || existing.expiresAt <= now) uncached.push(addr);
  }

  // Resolve uncached addresses (in parallel, individually)
  if (uncached.length > 0) {
    const results: Array<{ status: string; value?: string | null }> = await Promise.allSettled(
      uncached.map((addr) => resolveBasename(addr)),
    );
    for (let i = 0; i < uncached.length; i++) {
      const r = results[i];
      const name = r.status === "fulfilled" ? r.value ?? null : null;
      nameCache.set(uncached[i], {
        name: name ?? null,
        expiresAt: now + CACHE_TTL_MS,
      });
    }
    emit();
  }

  // Return current cache state for all requested addresses
  const result = new Map<string, string | null>();
  for (const addr of unique) {
    result.set(addr, nameCache.get(addr)?.name ?? null);
  }
  return result;
}

/**
 * Resolve a wallet address to its Basename (e.g. `omiaydin.base.eth`).
 *
 * Uses a two-tier approach:
 *  1. Shared in-memory cache (populated from Turso indexer or prior resolutions)
 *  2. On-chain resolution via Basenames L2 Universal Resolver
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
