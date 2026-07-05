"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getName, getNames } from "@coinbase/onchainkit/identity";
import { isAddress, type Address } from "viem";
import { base } from "viem/chains";

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

function ensureResolved(key: string) {
  if (inflight.has(key)) return;

  const existing = nameCache.get(key);
  if (existing && existing.expiresAt > Date.now()) return;

  inflight.add(key);

  getName({ address: key as Address, chain: base })
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
 * Batch-resolve basenames for multiple addresses at once using OnchainKit's
 * `getNames` (which internally uses multicall on Base, then verifies forward
 * resolution). Seeds results into the shared cache so individual `useBaseName`
 * calls hit the cache on subsequent renders.
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

  // Resolve uncached addresses in batch
  if (uncached.length > 0) {
    try {
      const names = await getNames({ addresses: uncached, chain: base });
      for (let i = 0; i < uncached.length; i++) {
        nameCache.set(uncached[i], {
          name: names[i] ?? null,
          expiresAt: now + CACHE_TTL_MS,
        });
      }
    } catch {
      for (const addr of uncached) {
        if (!nameCache.has(addr)) {
          nameCache.set(addr, { name: null, expiresAt: now + 30_000 });
        }
      }
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
 * Uses a three-tier approach:
 *  1. Shared in-memory cache (populated from Turso indexer or prior resolutions)
 *  2. OnchainKit's `getName` (uses the app's wagmi provider + multicall on Base)
 *  3. Automatic short-TTL retry on failure
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
