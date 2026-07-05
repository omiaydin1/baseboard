"use client";

import { useEffect, useSyncExternalStore } from "react";
import { isAddress, type Address } from "viem";

// ---------------------------------------------------------------------------
// Shared, deduplicated Basename cache (populated exclusively from Turso
// indexer — no RPC calls, no CCIP-read gateways, no API keys).
// ---------------------------------------------------------------------------

interface CacheEntry {
  name: string | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000;

const nameCache = new Map<string, CacheEntry>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
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
 * Batch-resolve basenames — returns cached values only; never makes RPC
 * calls. Addresses not yet cached by the Turso indexer return null.
 */
export async function resolveBaseNamesBatch(
  addresses: Address[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const now = Date.now();
  for (const addr of addresses) {
    const key = addr.toLowerCase();
    const entry = nameCache.get(key);
    if (entry && entry.expiresAt > now) {
      result.set(key, entry.name);
    } else {
      result.set(key, null);
    }
  }
  return result;
}

/**
 * Resolve a wallet address to its Basename.
 *
 * Uses cache only — no RPC calls. Names are populated by the Turso indexer
 * via `seedNameCache`. Uncached addresses return null (shown as truncated
 * hex addresses in the UI).
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
    if (key) {
      const existing = nameCache.get(key);
      if (!existing || existing.expiresAt <= Date.now()) {
        nameCache.set(key, { name: null, expiresAt: Date.now() + CACHE_TTL_MS });
        emit();
      }
    }
  }, [key]);

  return name;
}
