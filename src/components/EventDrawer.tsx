"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatEther } from "viem";
import {
  useAccount,
  usePublicClient,
  useSignMessage,
  useWalletClient,
} from "wagmi";
import { Drawer } from "./Drawer";
import { Spinner } from "./Spinner";
import { WalletConnect } from "./WalletConnect";
import { useBoardStore, type EventDraft } from "@/store/useBoardStore";
import { eventPlotCount, loadEvents, useEvents } from "@/lib/eventReveals";
import type { EventReveal } from "@/lib/event";
import {
  EVENT_IMAGE_MAX_BYTES,
  EVENT_IMAGE_TARGET_BYTES,
  EVENT_PRICE_PER_PIXEL_ETH,
  EVENT_PRICE_PER_PIXEL_WEI,
  MAX_EVENT_AREA,
  TREASURY_ADDRESS,
} from "@/lib/constants";
import { compressImageFile, MAX_UPLOAD_BYTES, validateLinkUrl } from "@/lib/image";
import { classifyImageNsfw, screenImageText } from "@/lib/imageModeration";

const TOP_N = 10;

type View = "list" | "create";

export function EventDrawer() {
  const open = useBoardStore((s) => s.eventDrawerOpen);
  const setOpen = useBoardStore((s) => s.setEventDrawerOpen);
  const setFocusBounds = useBoardStore((s) => s.setFocusBounds);
  const setEventCreateMode = useBoardStore((s) => s.setEventCreateMode);
  const eventDraft = useBoardStore((s) => s.eventDraft);
  const setEventDraft = useBoardStore((s) => s.setEventDraft);
  const pushToast = useBoardStore((s) => s.pushToast);
  const { address, isConnected } = useAccount();

  const events = useEvents();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState("");

  // Reset transient state whenever the drawer closes.
  useEffect(() => {
    if (open) return;
    setQuery("");
    setView("list");
    setEditingId(null);
    setLinkDraft("");
    setEventDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A fresh board selection reopens the drawer in create view with the
  // coordinates pre-filled. Opening the drawer without a fresh draft exits
  // any leftover create mode (e.g. the user abandoned a selection).
  useEffect(() => {
    if (open && eventDraft) {
      setView("create");
    } else if (open && !eventDraft) {
      setEventCreateMode(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eventDraft]);

  const sorted = useMemo(
    () => [...events].sort((a, b) => eventPlotCount(b) - eventPlotCount(a)),
    [events],
  );

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return sorted.slice(0, TOP_N);
    return sorted.filter((e) => e.title.toLowerCase().includes(q));
  }, [sorted, q]);

  const flyTo = (e: EventReveal) => {
    setFocusBounds({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 });
    setOpen(false);
  };

  const startCreate = () => {
    setEventCreateMode(true);
    setOpen(false);
  };

  return (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      title={view === "create" ? "Create Event" : "Events"}
      subtitle={
        view === "create" ? (
          <p className="text-xs text-slate-500">Set up a new reveal event</p>
        ) : (
          <p className="text-xs text-slate-500">
            Community reveal events · largest first
          </p>
        )
      }
    >
      {view === "create" ? (
        <CreateEventForm
          key={eventDraft ? `${eventDraft.x1},${eventDraft.y1},${eventDraft.x2},${eventDraft.y2}` : "none"}
          draft={eventDraft}
          onCancel={() => {
            setEventDraft(null);
            setView("list");
          }}
          onCreated={(box) => {
            setView("list");
            setEventDraft(null);
            setFocusBounds({ x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 });
            setOpen(false);
          }}
        />
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={startCreate}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-base-blue py-2.5 text-sm font-bold text-white transition hover:bg-base-dark"
          >
            ✏️ Create Event
          </button>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events…"
            className="w-full rounded-lg border-2 border-blue-100 px-3 py-2 text-sm focus:border-base-blue focus:outline-none"
          />

          {sorted.length === 0 ? (
            <p className="mt-10 text-center text-sm text-slate-500">
              No events yet — check back soon!
            </p>
          ) : visible.length === 0 ? (
            <p className="mt-10 text-center text-sm text-slate-500">
              No events match “{query.trim()}”.
            </p>
          ) : (
            <>
              {!q && sorted.length > TOP_N && (
                <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-base-blue">
                  Showing the top {TOP_N} events — use search to find the rest.
                </p>
              )}
              <ul className="space-y-2">
                {visible.map((e) => (
                  <EventRow
                    key={e.id}
                    event={e}
                    isMine={
                      !!address && !!e.creator && e.creator.toLowerCase() === address.toLowerCase()
                    }
                    editing={editingId === e.id}
                    linkDraft={linkDraft}
                    onStartEdit={() => {
                      setEditingId(e.id);
                      setLinkDraft(e.link ?? "");
                    }}
                    onCancelEdit={() => {
                      setEditingId(null);
                      setLinkDraft("");
                    }}
                    onLinkDraftChange={setLinkDraft}
                    onFlyTo={() => flyTo(e)}
                    onSaved={() => {
                      setEditingId(null);
                      setLinkDraft("");
                    }}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

function EventRow({
  event: e,
  isMine,
  editing,
  linkDraft,
  onStartEdit,
  onCancelEdit,
  onLinkDraftChange,
  onFlyTo,
  onSaved,
}: {
  event: EventReveal;
  isMine: boolean;
  editing: boolean;
  linkDraft: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onLinkDraftChange: (v: string) => void;
  onFlyTo: () => void;
  onSaved: () => void;
}) {
  const pushToast = useBoardStore((s) => s.pushToast);
  const { signMessageAsync } = useSignMessage();
  const [saving, setSaving] = useState(false);

  const w = e.x2 - e.x1 + 1;
  const h = e.y2 - e.y1 + 1;
  const count = eventPlotCount(e);

  const linkCheck = validateLinkUrl(linkDraft);

  const saveLink = async () => {
    if (!linkCheck.ok) {
      pushToast("error", "Invalid or restricted link");
      return;
    }
    setSaving(true);
    try {
      const ts = Math.floor(Date.now() / 1000);
      const signature = await signMessageAsync({
        message: `update-event-link:${e.id}:${ts}`,
      });
      const res = await fetch(`/api/events/${e.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          link: linkCheck.url ?? "",
          signature,
          timestamp: ts,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Could not update the link");
      await loadEvents(true);
      pushToast("success", "Event link updated");
      onSaved();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Could not update the link");
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="rounded-xl border-2 border-blue-100 bg-white p-2.5 transition hover:border-base-blue hover:bg-blue-50">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onFlyTo} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={e.imagePath}
            alt={e.title}
            width={56}
            height={56}
            className="h-14 w-14 shrink-0 rounded-lg border border-blue-100 bg-slate-50 object-contain"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-bold text-base-blue">
              {e.title}
            </span>
            <span className="block text-xs text-slate-500">
              {w}×{h} area · {count.toLocaleString()} px
            </span>
          </span>
        </button>
        {e.link && (
          <a
            href={e.link}
            target="_blank"
            rel="noopener noreferrer"
            title={e.link}
            className="shrink-0 rounded-md bg-blue-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-base-blue transition hover:bg-base-blue hover:text-white"
          >
            link ↗
          </a>
        )}
        {isMine && (
          <button
            type="button"
            onClick={onStartEdit}
            title="Edit link"
            className="shrink-0 rounded-md border-2 border-base-blue px-2 py-1 text-xs font-bold text-base-blue hover:bg-blue-50"
          >
            ✎
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-2 space-y-2 border-t-2 border-blue-100 pt-2">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Link (shown on bought pixels)
            </label>
            <input
              type="url"
              inputMode="url"
              value={linkDraft}
              onChange={(e) => onLinkDraftChange(e.target.value)}
              placeholder="https://your-site.com"
              className={`mt-1 w-full rounded-lg border-2 px-3 py-1.5 text-sm focus:outline-none ${
                linkDraft && !linkCheck.ok
                  ? "border-red-300 focus:border-red-400"
                  : "border-blue-100 focus:border-base-blue"
              }`}
            />
            {linkDraft && !linkCheck.ok && (
              <p className="mt-1 text-[11px] font-medium text-red-600">
                Invalid or restricted link.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveLink}
              disabled={saving || !linkCheck.ok}
              className="flex items-center gap-1.5 rounded-lg bg-base-blue px-3 py-1.5 text-sm font-bold text-white hover:bg-base-dark disabled:opacity-50"
            >
              {saving && <Spinner size={14} className="!border-white/40 !border-t-white" />}
              Save link
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              disabled={saving}
              className="rounded-lg border-2 border-base-blue px-3 py-1.5 text-sm font-semibold text-base-blue hover:bg-blue-50 disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function CreateEventForm({
  draft,
  onCancel,
  onCreated,
}: {
  draft: EventDraft | null;
  onCancel: () => void;
  onCreated: (box: { x1: number; y1: number; x2: number; y2: number }) => void;
}) {
  const setEventCreateMode = useBoardStore((s) => s.setEventCreateMode);
  const setOpen = useBoardStore((s) => s.setEventDrawerOpen);
  const pushToast = useBoardStore((s) => s.pushToast);
  const { address, isConnected } = useAccount();
  const walletClient = useWalletClient();
  const publicClient = usePublicClient();

  const [title, setTitle] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = draft
    ? (draft.x2 - draft.x1 + 1) * (draft.y2 - draft.y1 + 1)
    : 0;
  const price = EVENT_PRICE_PER_PIXEL_WEI * BigInt(count);
  const linkCheck = validateLinkUrl(link);

  const selectOnBoard = () => {
    setEventCreateMode(true);
    setOpen(false);
  };

  const submit = async () => {
    if (!draft) return;
    if (!title.trim()) {
      setError("Give your event a name.");
      return;
    }
    if (!image) {
      setError("Upload the image for your event.");
      return;
    }
    if (!linkCheck.ok) {
      setError("Invalid or restricted link.");
      return;
    }
    if (!walletClient.data) {
      setError("Connect a wallet to create an event.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 1/10 of the normal price, sent directly to the treasury. The server
      // verifies this transfer on-chain before publishing the event.
      const hash = await walletClient.data.sendTransaction({
        to: TREASURY_ADDRESS,
        value: price,
      });
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
      }
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          x1: draft.x1,
          y1: draft.y1,
          x2: draft.x2,
          y2: draft.y2,
          image,
          link: linkCheck.url ?? "",
          txHash: hash,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Could not create the event");
      await loadEvents(true);
      pushToast("success", "Event created — the board now shows its preview!");
      onCreated(draft);
    } catch (err) {
      const msg =
        err instanceof Error && err.message && err.message !== "0x"
          ? err.message
          : "Transaction rejected";
      setError(msg);
      pushToast("error", msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex items-center gap-1 rounded-lg border-2 border-base-blue px-3 py-1.5 text-sm font-semibold text-base-blue hover:bg-blue-50"
      >
        ← Back to events
      </button>

      {!draft ? (
        <div className="flex flex-col items-center gap-3 rounded-xl bg-blue-50 p-5 text-center">
          <p className="text-sm text-slate-600">
            Draw a rectangle on the board to mark your event area — any size up
            to {MAX_EVENT_AREA.toLocaleString()} pixels.
          </p>
          <button
            type="button"
            onClick={selectOnBoard}
            className="rounded-xl bg-base-blue px-4 py-2 text-sm font-bold text-white hover:bg-base-dark"
          >
            Select area on board
          </button>
        </div>
      ) : (
        <>
          <div className="rounded-xl bg-blue-50 p-3 text-sm">
            <p className="font-semibold text-base-blue">
              Region ({draft.x1}, {draft.y1}) → ({draft.x2}, {draft.y2})
            </p>
            <p className="mt-1 text-slate-600">
              {count.toLocaleString()} pixels · price{" "}
              <span className="font-bold text-base-blue">
                {formatEther(price)} ETH
              </span>{" "}
              ({EVENT_PRICE_PER_PIXEL_ETH} per pixel — 1/10 of the normal price)
            </p>
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Event name
            </label>
            <input
              type="text"
              value={title}
              maxLength={60}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Base Mural #1"
              className="mt-1 w-full rounded-lg border-2 border-blue-100 px-3 py-2 text-sm focus:border-base-blue focus:outline-none"
            />
          </div>

          <EventImageField value={image} onChange={setImage} />

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Link (optional — shown on bought pixels)
            </label>
            <input
              type="url"
              inputMode="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://your-site.com"
              className={`mt-1 w-full rounded-lg border-2 px-3 py-1.5 text-sm focus:outline-none ${
                link && !linkCheck.ok
                  ? "border-red-300 focus:border-red-400"
                  : "border-blue-100 focus:border-base-blue"
              }`}
            />
            {link && !linkCheck.ok && (
              <p className="mt-1 text-[11px] font-medium text-red-600">
                Invalid or restricted link.
              </p>
            )}
          </div>

          {error && (
            <p className="break-words rounded-lg bg-red-50 p-3 text-xs font-medium text-red-600">
              {error}
            </p>
          )}

          {!isConnected ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-slate-500">
                Connect a wallet to create the event.
              </p>
              <WalletConnect />
            </div>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={busy || !title.trim() || !image || !linkCheck.ok}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-base-blue py-3 font-bold text-white hover:bg-base-dark disabled:opacity-50"
            >
              {busy && <Spinner size={16} className="!border-white/40 !border-t-white" />}
              {busy
                ? "Sending payment…"
                : `Create event · ${formatEther(price)} ETH`}
            </button>
          )}

          <p className="text-center text-[11px] text-slate-400">
            Paying from <span className="font-mono">{address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "your wallet"}</span> to the BaseBoard treasury. Your event is published once the payment is verified on-chain.
          </p>
        </>
      )}
    </div>
  );
}

function EventImageField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (dataUri: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"scan" | "compress" | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onPick = async (file: File | undefined) => {
    setError(null);
    setInfo(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB — max 20 MB.`);
      return;
    }
    // Fail-open content screening (CDN-loaded libs may be unreachable).
    setBusy("scan");
    try {
      const [nsfwResult, textResult] = await Promise.all([
        classifyImageNsfw(file).catch(() => ({ blocked: false })),
        screenImageText(file).catch(() => ({ blocked: false })),
      ]);
      if (nsfwResult.blocked || textResult.blocked) {
        setError("Restricted image content detected. Please choose a different image.");
        return;
      }
    } finally {
      setBusy(null);
    }
    setBusy("compress");
    try {
      const res = await compressImageFile(file, {
        targetBytes: EVENT_IMAGE_TARGET_BYTES,
        hardCapBytes: EVENT_IMAGE_MAX_BYTES,
        maxDim: 640,
      });
      if (res.tooLarge) {
        setError(
          `That image is too detailed (${(res.bytes / 1024).toFixed(1)} KB). Try a simpler picture.`,
        );
        return;
      }
      onChange(res.dataUri);
      setInfo(`Ready · ${(res.bytes / 1024).toFixed(1)} KB · ${res.width}×${res.height}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process that image");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        Event image
      </label>
      {value ? (
        <div className="overflow-hidden rounded-xl border-2 border-blue-100 bg-slate-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="event preview"
            width="100%"
            className="max-h-52 w-full object-contain"
          />
          {info && <p className="px-2 py-1 text-[11px] font-semibold text-green-600">{info}</p>}
        </div>
      ) : (
        <label
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/40 px-3 py-4 text-center transition hover:border-base-blue hover:bg-blue-50 ${
            busy ? "pointer-events-none opacity-60" : ""
          }`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 16V4m0 0L8 8m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
              stroke="#0052ff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-xs font-bold text-base-blue">Upload from device</span>
          <span className="text-[10px] text-slate-500">
            Shown grayscale over your region — real colours appear as pixels are bought
          </span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0])}
          />
        </label>
      )}
      {busy && (
        <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <Spinner size={13} /> {busy === "scan" ? "Scanning image…" : "Optimizing image…"}
        </p>
      )}
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            if (inputRef.current) inputRef.current.value = "";
          }}
          className="rounded-lg border-2 border-base-blue px-3 py-1.5 text-xs font-semibold text-base-blue hover:bg-blue-50"
        >
          Choose a different image
        </button>
      )}
      {error && <p className="break-words text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
