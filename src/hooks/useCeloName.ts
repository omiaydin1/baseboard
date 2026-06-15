"use client";

import { useEffect, useState } from "react";
import { createPublicClient, http, isAddress, type Address } from "viem";
import { celo } from "viem/chains";
import {
  CELO_CHAIN_ID,
  CELO_NAME_UNIVERSAL_RESOLVER,
  getChainConfig,
} from "@/lib/constants";

/**
 * Resolve a connected Celo account to its human-readable Celo Name Service
 * (.celo) name via an ENS-compatible reverse lookup. Celo has no single
 * canonical public reverse registry, so resolution runs only when a universal
 * resolver is configured (`NEXT_PUBLIC_CELO_NAME_RESOLVER`); otherwise it
 * returns null and callers fall back to the short hex address.
 */
export function useCeloName(address?: Address): string | null {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    setName(null);
    if (!address || !isAddress(CELO_NAME_UNIVERSAL_RESOLVER)) return;

    let cancelled = false;
    const rpcUrl =
      getChainConfig(CELO_CHAIN_ID)?.rpcUrl ?? "https://forno.celo.org";
    const client = createPublicClient({
      chain: celo,
      transport: http(rpcUrl),
    });

    client
      .getEnsName({
        address,
        universalResolverAddress: CELO_NAME_UNIVERSAL_RESOLVER as Address,
      })
      .then((resolved) => {
        if (!cancelled) setName(resolved ?? null);
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
