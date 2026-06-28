"use client";

import Link from "next/link";
import { BaseBoardCanvas } from "@/components/BaseBoardCanvas";
import { HangingHeader } from "@/components/HangingHeader";
import { StatsDashboard } from "@/components/StatsDashboard";
import { WalletConnect } from "@/components/WalletConnect";
import { NetworkGuard } from "@/components/NetworkGuard";
import { ProfileDrawer } from "@/components/ProfileDrawer";
import { LeaderboardDrawer } from "@/components/LeaderboardDrawer";
import { NetworkSelector } from "@/components/NetworkSelector";
import { PlotModal } from "@/components/PlotModal";
import { BuyModal } from "@/components/BuyModal";
import { Legend } from "@/components/Legend";
import { DensityControls } from "@/components/DensityControls";
import { Toaster } from "@/components/Toaster";
import { PendingTxRecovery } from "@/components/PendingTxRecovery";
import { AllMintedProvider } from "@/hooks/useAllMintedContext";
import { useBoardStore } from "@/store/useBoardStore";
import { useActiveChainConfig } from "@/hooks/useActiveContract";

/** Person silhouette icon preceding "My Profile". */
function ProfileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20a7 7 0 0 1 14 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Trophy icon preceding "Leaderboard", matching ProfileIcon's size/technique. */
function TrophyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 4h8v4a4 4 0 0 1-8 0V4Zm0 1H5a2 2 0 0 0 2 3m9-3h3a2 2 0 0 1-2 3M12 12v3m-3 4h6m-5 0 .5-4m4.5 4-.5-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Home() {
  const toggleProfile = useBoardStore((s) => s.toggleProfile);
  const toggleLeaderboard = useBoardStore((s) => s.toggleLeaderboard);
  const cfg = useActiveChainConfig();

  return (
    <AllMintedProvider>
    <div className="flex h-screen flex-col bg-white">
      <NetworkGuard />

      {/* Top bar: stats dashboard + actions */}
      <header className="relative z-30 border-b border-blue-100 bg-white/90 px-3 py-1 backdrop-blur sm:px-4 sm:py-1.5">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1">
            <StatsDashboard />
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleProfile}
              className="inline-flex items-center gap-1.5 rounded-xl border-2 border-base-blue px-3 py-2 text-sm font-semibold text-base-blue hover:bg-blue-50 sm:px-4"
            >
              <ProfileIcon />
              My Profile
            </button>
            <button
              type="button"
              onClick={toggleLeaderboard}
              className="inline-flex items-center gap-1.5 rounded-xl border-2 border-base-blue px-3 py-2 text-sm font-semibold text-base-blue hover:bg-blue-50 sm:px-4"
            >
              <TrophyIcon />
              Leaderboard
            </button>
            <NetworkSelector />
            <WalletConnect />
          </div>
        </div>
      </header>

      {/* The board, framed and hanging on a white wall */}
      <main className="flex flex-1 flex-col items-center overflow-hidden px-4 pt-0.5">
        <HangingHeader />

        <div className="relative z-10 mt-2 w-full max-w-7xl flex-1 overflow-hidden rounded-[16px] border-[5px] border-base-blue bg-white shadow-frame sm:rounded-[22px] sm:border-[9px]">
          {/* inner shadow ring to enhance the "framed canvas" depth */}
          <div className="pointer-events-none absolute inset-0 z-10 rounded-[10px] shadow-[inset_0_0_20px_rgba(0,82,255,0.12)] sm:rounded-[16px] sm:shadow-[inset_0_0_30px_rgba(0,82,255,0.12)]" />
          <BaseBoardCanvas />
          {/* Heatmap toggle + activity ruler, centered on the canvas bottom. */}
          <DensityControls />
        </div>

        <div className="my-2 flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Legend />
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <p>
              BaseBoard · 3162 × 3162 grid · {cfg.name} ({cfg.chainId})
            </p>
            <nav className="flex items-center gap-2">
              <Link href="/privacy" className="hover:text-base-blue">
                Privacy
              </Link>
              <span aria-hidden="true">·</span>
              <Link href="/terms" className="hover:text-base-blue">
                Terms
              </Link>
            </nav>
          </div>
        </div>
      </main>

      {/* Overlays */}
      <ProfileDrawer />
      <LeaderboardDrawer />
      <PlotModal />
      <BuyModal />
      <Toaster />
      <PendingTxRecovery />
    </div>
    </AllMintedProvider>
  );
}
