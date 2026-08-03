"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BaseBoardCanvas } from "@/components/BaseBoardCanvas";
import { HangingHeader } from "@/components/HangingHeader";
import { StatsDashboard } from "@/components/StatsDashboard";
import { WalletConnect } from "@/components/WalletConnect";
import { NetworkGuard } from "@/components/NetworkGuard";
import { ProfileDrawer } from "@/components/ProfileDrawer";
import { LeaderboardDrawer } from "@/components/LeaderboardDrawer";
import { EventDrawer } from "@/components/EventDrawer";
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
import { GRID_SIZE } from "@/lib/constants";
import { getEvents, loadEvents, subscribeEvents } from "@/lib/eventReveals";

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

/** Palette icon preceding "Event", matching the other header icons. */
function PaletteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.7 1.5-1.5 0-.4-.2-.7-.4-.9-.3-.3-.4-.6-.4-.9 0-.8.7-1.4 1.5-1.4h1.5A4.4 4.4 0 0 0 20 12.4C20 7.2 16.4 3 12 3Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="10" r="1.2" fill="currentColor" />
      <circle cx="12" cy="7.5" r="1.2" fill="currentColor" />
      <circle cx="16" cy="10" r="1.2" fill="currentColor" />
    </svg>
  );
}

export default function Home() {
  const toggleProfile = useBoardStore((s) => s.toggleProfile);
  const toggleLeaderboard = useBoardStore((s) => s.toggleLeaderboard);
  const toggleEventDrawer = useBoardStore((s) => s.toggleEventDrawer);
  const openPlot = useBoardStore((s) => s.openPlot);
  const setFocusPlotId = useBoardStore((s) => s.setFocusPlotId);
  const setFocusBounds = useBoardStore((s) => s.setFocusBounds);
  const cfg = useActiveChainConfig();

  // Deep link: `?pixel=<id>` auto-opens the existing Pixel Details modal for
  // that pixel on load (and flies the camera to it), reusing the same
  // open-plot mechanism the board's own click handler uses — no new route.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("pixel");
    if (raw == null) return;
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 0 || id >= GRID_SIZE * GRID_SIZE) return;
    openPlot(id);
    setFocusPlotId(id);
  }, [openPlot, setFocusPlotId]);

  // Deep link: `?event=<id>` (shared from the creator's profile) flies the
  // camera to the event region once it is known — seed events resolve
  // immediately, DB events once GET /api/events lands.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("event");
    if (raw == null) return;
    const tryFocus = () => {
      const ev = getEvents().find((c) => c.id === raw);
      if (!ev) return false;
      setFocusBounds({ x1: ev.x1, y1: ev.y1, x2: ev.x2, y2: ev.y2 });
      return true;
    };
    if (tryFocus()) return;
    const unsubscribe = subscribeEvents(() => {
      if (tryFocus()) unsubscribe();
    });
    void loadEvents();
    const timer = setTimeout(() => unsubscribe(), 8000);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [setFocusBounds]);

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
            <button
              type="button"
              onClick={toggleEventDrawer}
              className="inline-flex items-center gap-1.5 rounded-xl border-2 border-base-blue px-3 py-2 text-sm font-semibold text-base-blue hover:bg-blue-50 sm:px-4"
            >
              <PaletteIcon />
              Event
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
        </div>

        {/* Heatmap toggle + activity ruler, centered below the board frame. */}
        <div className="mt-2 flex w-full max-w-7xl justify-center">
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
      <EventDrawer />
      <PlotModal />
      <BuyModal />
      <Toaster />
      <PendingTxRecovery />
    </div>
    </AllMintedProvider>
  );
}
