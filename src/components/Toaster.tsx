"use client";

import type { ReactElement } from "react";
import { useBoardStore } from "@/store/useBoardStore";
import type { ToastKind } from "@/store/useBoardStore";

const STYLES: Record<ToastKind, { bar: string; icon: ReactElement }> = {
  success: {
    bar: "border-green-200 bg-green-50 text-green-800",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0">
        <path
          d="M20 6L9 17l-5-5"
          stroke="#16a34a"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  error: {
    bar: "border-red-200 bg-red-50 text-red-800",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0">
        <path
          d="M12 8v5m0 3h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
          stroke="#dc2626"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  info: {
    bar: "border-blue-200 bg-blue-50 text-base-blue",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0">
        <circle cx="12" cy="12" r="9" stroke="#0052ff" strokeWidth="2" />
        <path d="M12 11v5m0-8h.01" stroke="#0052ff" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    ),
  },
};

/** Fixed, top-center stack of transient toast notifications. */
export function Toaster() {
  const toasts = useBoardStore((s) => s.toasts);
  const dismissToast = useBoardStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`toast-in pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border-2 px-3.5 py-2.5 text-sm font-semibold shadow-lg ${STYLES[t.kind].bar}`}
        >
          {STYLES[t.kind].icon}
          <span className="flex-1 break-words leading-snug">{t.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="dismiss"
            className="-mr-1 shrink-0 rounded-md p-0.5 text-current opacity-50 hover:opacity-100"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
