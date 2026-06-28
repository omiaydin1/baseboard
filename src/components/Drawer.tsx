"use client";

import { useEffect, type ReactNode } from "react";

/**
 * Shared right-side slide-in drawer chrome (backdrop + panel + standard header
 * with a "Back to Board" button, title/subtitle, and a close ✕). Both the
 * "My Profile" and "Leaderboard" drawers render through this single component so
 * their width, slide direction, backdrop behavior and header style stay
 * identical rather than being implemented twice.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-slate-900/30 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />

      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l-4 border-base-blue bg-white shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="border-b-2 border-blue-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="mb-3 inline-flex items-center gap-1.5 rounded-lg border-2 border-base-blue px-3 py-1.5 text-sm font-semibold text-base-blue transition hover:bg-blue-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M15 18l-6-6 6-6"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Back to Board
          </button>

          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <h2 className="text-xl font-black text-base-blue">{title}</h2>
              {subtitle}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              aria-label="close drawer"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </header>

        <div className="thin-scrollbar flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </>
  );
}
