"use client";

import { BaseBoardCanvas } from "@/components/BaseBoardCanvas";
import { HangingHeader } from "@/components/HangingHeader";
import { StatsDashboard } from "@/components/StatsDashboard";
import { WalletConnect } from "@/components/WalletConnect";
import { NetworkGuard } from "@/components/NetworkGuard";
import { ProfileDrawer } from "@/components/ProfileDrawer";
import { PlotModal } from "@/components/PlotModal";
import { BuyModal } from "@/components/BuyModal";
import { Legend } from "@/components/Legend";
import { Toaster } from "@/components/Toaster";
import { useBoardStore } from "@/store/useBoardStore";

export default function Home() {
  const toggleProfile = useBoardStore((s) => s.toggleProfile);

  return (
    <div className="flex h-screen flex-col bg-white">
      <NetworkGuard />

      {/* Top bar: stats dashboard + actions */}
      <header className="border-b border-blue-100 bg-white/90 px-3 py-2 backdrop-blur sm:px-4 sm:py-3">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1">
            <StatsDashboard />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={toggleProfile}
              className="rounded-xl border-2 border-base-blue px-4 py-2 text-sm font-semibold text-base-blue hover:bg-blue-50"
            >
              My Profile
            </button>
            <WalletConnect />
          </div>
        </div>
      </header>

      {/* The board, framed and hanging on a white wall */}
      <main className="flex flex-1 flex-col items-center overflow-hidden px-4 pt-3">
        <HangingHeader />

        <div className="relative mt-1 w-full max-w-7xl flex-1 overflow-hidden rounded-[16px] border-[6px] border-base-blue bg-white shadow-frame sm:rounded-[28px] sm:border-[12px]">
          {/* inner shadow ring to enhance the "framed canvas" depth */}
          <div className="pointer-events-none absolute inset-0 z-10 rounded-[10px] shadow-[inset_0_0_20px_rgba(0,82,255,0.12)] sm:rounded-[16px] sm:shadow-[inset_0_0_30px_rgba(0,82,255,0.12)]" />
          <BaseBoardCanvas />
        </div>

        <div className="my-2 flex w-full max-w-7xl items-center justify-between">
          <Legend />
          <p className="text-xs text-slate-400">
            BaseBoard · 3162 × 3162 grid · Base Mainnet (8453)
          </p>
        </div>
      </main>

      {/* Overlays */}
      <ProfileDrawer />
      <PlotModal />
      <BuyModal />
      <Toaster />
    </div>
  );
}
