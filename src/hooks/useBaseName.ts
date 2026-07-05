"use client";

import { useEffect, useSyncExternalStore } from "react";
import { isAddress, type Address } from "viem";

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

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

async function resolveViaApi(address: Address): Promise<string | null> {
  try {
    const res = await fetch(`/api/basename?address=${address}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.name ?? null;
  } catch {
    return null;
  }
}

function ensureResolved(key: string) {
  if (inflight.has(key)) return;

  const existing = nameCache.get(key);
  if (existing && existing.expiresAt > Date.now()) return;

  inflight.add(key);

  resolveViaApi(key as Address)
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

/**
 * Seed the shared name cache with known basenames (e.g. from Turso API).
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
 * Batch-resolve basenames for multiple addresses via the server-side API.
 */
export async function resolveBaseNamesBatch(
  addresses: Address[],
): Promise<Map<string, string | null>> {
  if (addresses.length === 0) return new Map();

  const unique = [...new Set(addresses.map((a) => a.toLowerCase() as Address))];
  const now = Date.now();

  const uncached: Address[] = [];
  for (const addr of unique) {
    const existing = nameCache.get(addr);
    if (!existing || existing.expiresAt <= now) uncached.push(addr);
  }

  if (uncached.length > 0) {
    try {
      const res = await fetch(`/api/basename?addresses=${uncached.join(",")}`);
      if (res.ok) {
        const data = await res.json();
        if (data.names) {
          for (const [addr, name] of Object.entries(data.names)) {
            nameCache.set(addr.toLowerCase(), {
              name: (name as string | null) ?? null,
              expiresAt: now + CACHE_TTL_MS,
            });
          }
        }
      }
    } catch {
      // API unavailable — keep existing cache
    }
    emit();
  }

  const result = new Map<string, string | null>();
  for (const addr of unique) {
    result.set(addr, nameCache.get(addr)?.name ?? null);
  }
  return result;
}

/**
 * Resolve a wallet address to its Basename.
 *
 * Uses a shared cache populated by Turso indexer data or server-side API.
 * Uncached addresses return null (shown as truncated hex).
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
