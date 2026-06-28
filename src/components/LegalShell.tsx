import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared chrome for the static legal pages (Privacy, Terms). Mobile-first,
 * single readable column, matching the app's white / Base-blue theme.
 */
export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-5 py-8 sm:py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 rounded-lg border-2 border-base-blue px-3 py-1.5 text-sm font-semibold text-base-blue transition hover:bg-blue-50"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path
            d="M15 18l-6-6 6-6"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Back to Board
      </Link>

      <h1 className="mt-6 text-2xl font-black tracking-tight text-base-blue sm:text-3xl">
        {title}
      </h1>
      <p className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-400">
        Last updated {updated}
      </p>

      <div className="legal-prose mt-6 space-y-5 text-sm leading-relaxed text-slate-700">
        {children}
      </div>

      <footer className="mt-10 flex items-center gap-3 border-t border-blue-100 pt-5 text-xs text-slate-400">
        <Link href="/privacy" className="hover:text-base-blue">
          Privacy
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/terms" className="hover:text-base-blue">
          Terms
        </Link>
      </footer>
    </main>
  );
}

/** Section heading inside a legal page. */
export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold text-slate-900">{heading}</h2>
      {children}
    </section>
  );
}
