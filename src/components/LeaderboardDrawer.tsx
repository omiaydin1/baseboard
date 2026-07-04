"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { Drawer } from "./Drawer";
import { Spinner } from "./Spinner";
import { useBoardStore } from "@/store/useBoardStore";
import { useActiveChainConfig } from "@/hooks/useActiveContract";
import { type LeaderEntry } from "@/hooks/useBaseBoard";
import { useAllMintedContext } from "@/hooks/useAllMintedContext";
import { useBaseName } from "@/hooks/useBaseName";
import { useLeaderboardAge } from "@/hooks/useBaseBoard";
import { displayName } from "@/lib/coords";

const PAGE_SIZE = 10;

/**
 * Small, restrained medal badge for ranks 1–3 (gold / silver / bronze) — a
 * compact colored disc with the rank number, intentionally not a large emoji,
 * matching the app's understated style. Ranks 4+ render a plain number instead.
 */
function RankBadge({ rank }: { rank: number }) {
  const medal =
    rank === 1
      ? { bg: "bg-amber-100", ring: "ring-amber-300", text: "text-amber-700" }
      : rank === 2
        ? { bg: "bg-slate-100", ring: "ring-slate-300", text: "text-slate-600" }
        : rank === 3
          ? { bg: "bg-orange-100", ring: "ring-orange-300", text: "text-orange-700" }
          : null;

  if (!medal) {
    return (
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-sm font-bold text-slate-400 tabular-nums">
        {rank}
      </span>
    );
  }
  return (
    <span
      aria-label={`rank ${rank}`}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${medal.bg} ${medal.text} text-xs font-black ring-2 ${medal.ring}`}
    >
      {rank}
    </span>
  );
}

/** One leaderboard row — resolves the owner's Basename, falls back to 6+6 address. */
function LeaderRow({ entry, isMe }: { entry: LeaderEntry; isMe: boolean }) {
  const baseName = useBaseName(entry.owner);
  const display = displayName(baseName, entry.owner);

  return (
    <li
      className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 ${
        isMe ? "border-base-blue bg-blue-50" : "border-blue-100 bg-white"
      }`}
    >
      <RankBadge rank={entry.rank} />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate font-mono text-sm font-semibold text-slate-700">
          {display}
        </span>
        {isMe && (
          <span className="shrink-0 rounded-md bg-base-blue px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            You
          </span>
        )}
      </div>
      <span className="shrink-0 text-right text-sm font-black tabular-nums text-base-blue">
        {entry.count.toLocaleString()}
        <span className="ml-1 text-[10px] font-semibold uppercase text-base-light">
          px
        </span>
      </span>
    </li>
  );
}

export function LeaderboardDrawer() {
  const open = useBoardStore((s) => s.leaderboardOpen);
  const setOpen = useBoardStore((s) => s.setLeaderboardOpen);
  const cfg = useActiveChainConfig();
  const { address } = useAccount();
  const { loading, ranking } = useAllMintedContext();
  const age = useLeaderboardAge();

  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(ranking.length / PAGE_SIZE));

  // Keep the page index in range as data loads / changes.
  useEffect(() => {
    if (page > pageCount - 1) setPage(0);
  }, [page, pageCount]);

  const me = address?.toLowerCase();
  const myEntry = useMemo(
    () => (me ? ranking.find((e) => e.owner.toLowerCase() === me) : undefined),
    [ranking, me],
  );

  const pageRows = ranking.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  // Only pin a separate "Your rank" card when the connected wallet isn't already
  // visible on the current page — otherwise it duplicates the highlighted row.
  const myEntryVisible =
    !!me && pageRows.some((e) => e.owner.toLowerCase() === me);

  return (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      title="Leaderboard"
      subtitle={
        <p className="text-xs text-slate-500">
          Top pixel owners on {cfg.name}
          {age && <span className="ml-2 text-slate-400">· {age}</span>}
        </p>
      }
    >
      {!cfg.isConfigured ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          No BaseBoard contract is configured on {cfg.name}.
        </p>
      ) : loading && ranking.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner size={16} /> Ranking pixel owners…
        </div>
      ) : ranking.length === 0 ? (
        <div className="mt-10 text-center text-sm text-slate-500">
          No pixels have been bought yet — be the first on the board!
        </div>
      ) : (
        <div className="space-y-3">
          {/* Your standing, only when it's off the current page. */}
          {myEntry && !myEntryVisible && (
            <div className="rounded-xl bg-slate-50 p-2">
              <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Your rank
              </p>
              <ul>
                <LeaderRow entry={myEntry} isMe />
              </ul>
            </div>
          )}

          <ul className="space-y-2">
            {pageRows.map((entry) => (
              <LeaderRow
                key={entry.owner}
                entry={entry}
                isMe={!!me && entry.owner.toLowerCase() === me}
              />
            ))}
          </ul>

          {pageCount > 1 && (
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-lg border-2 border-base-blue px-3 py-1.5 text-sm font-semibold text-base-blue transition hover:bg-blue-50 disabled:opacity-40"
              >
                ‹ Prev
              </button>
              <span className="text-xs font-semibold text-slate-500">
                Page {page + 1} of {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                className="rounded-lg border-2 border-base-blue px-3 py-1.5 text-sm font-semibold text-base-blue transition hover:bg-blue-50 disabled:opacity-40"
              >
                Next ›
              </button>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
