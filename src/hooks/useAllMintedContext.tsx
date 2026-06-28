"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useAllMintedPlots, type AllMintedData } from "./useBaseBoard";

const AllMintedContext = createContext<AllMintedData | null>(null);

/**
 * Runs the shared on-chain scan (`useAllMintedPlots`) exactly once and shares
 * the result with every consumer, so the Leaderboard drawer and the activity
 * ticker read the same ranking/events without each triggering its own full
 * log-scan + batch-read pass.
 */
export function AllMintedProvider({ children }: { children: ReactNode }) {
  const data = useAllMintedPlots();
  return (
    <AllMintedContext.Provider value={data}>
      {children}
    </AllMintedContext.Provider>
  );
}

export function useAllMintedContext(): AllMintedData {
  const ctx = useContext(AllMintedContext);
  if (!ctx)
    return { loading: false, ranking: [], events: [] };
  return ctx;
}
