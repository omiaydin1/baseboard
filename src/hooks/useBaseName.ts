"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPublicClient, http, isAddress, toCoinType, type Address } from "viem";
import { mainnet } from "viem/chains";
import { base } from "viem/chains";

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

/**
 * Shared mainnet client for ENSIP-19 cross-chain name resolution. Uses the
 * default public RPC; in production a private RPC via `NEXT_PUBLIC_RPC_URL`
 * is strongly recommended for reliability.
 */
function getEnsClient() {
  const rpcUrl =
    (typeof process !== "undefined" &&
      (process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL)) ||
    undefined;
  return createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl, { timeout: 10_000 }),
  });
}

let ensClient: ReturnType<typeof getEnsClient> | null = null;
function client() {
  if (!ensClient) ensClient = getEnsClient();
  return ensClient;
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
    .getEnsName({
      address: key as Address,
      coinType: toCoinType(base.id),
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
 * Resolve a Basename (e.g. `omiaydin.base.eth`) via ENSIP-19 cross-chain
 * resolution on mainnet. Uses the shared cache so each address is fetched
 * at most once, and the result is consistent everywhere.
 *
 * - On success: cached for 5 minutes.
 * - On error: previous name survives; null cached with short TTL; retries
 *   with exponential back-off (1 s → 2 s → … → 60 s).
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
