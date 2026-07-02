"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatEther, parseEther } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { Spinner } from "./Spinner";
import { WalletConnect } from "./WalletConnect";
import { useBoardStore } from "@/store/useBoardStore";
import { usePlotsByOwner, useBaseBoardWrite } from "@/hooks/useBaseBoard";
import { useActiveChainConfig } from "@/hooks/useActiveContract";
import { baseBoardAbi, readContractWithTimeout } from "@/lib/contract";
import { GRID_SIZE, ZERO_ADDRESS } from "@/lib/constants";
import { plotIdFromXY, shortAddress, xyFromPlotId } from "@/lib/coords";
import { useBaseName } from "@/hooks/useBaseName";
import {
  MAX_ONCHAIN_IMAGE_BYTES,
  MAX_UPLOAD_BYTES,
  compressImageFile,
  dimForPlots,
  parseLink,
  stripZone,
  validateImageContent,
  validateLinkUrl,
  withMeta,
  type Zone,
} from "@/lib/image";
import type { Plot } from "@/lib/types";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)(\?.*)?$/i;

/**
 * Group owned plot ids into clusters of 4-neighbour adjacency. Each cluster is
 * one contiguous "purchase block", letting the multi-select UX offer a single
 * master checkbox to toggle every plot bought together at once.
 */
function clusterize(ids: number[]): number[][] {
  const set = new Set(ids);
  const seen = new Set<number>();
  const clusters: number[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const stack = [id];
    const cluster: number[] = [];
    while (stack.length) {
      const cur = stack.pop() as number;
      cluster.push(cur);
      const { x, y } = xyFromPlotId(cur);
      // 8-directional adjacency: plots touching on any side OR corner belong to
      // the same cohesive cluster, so an L-shape / diagonal block is grouped.
      const neighbours: number[] = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
          neighbours.push(plotIdFromXY(nx, ny));
        }
      }
      for (const n of neighbours) {
        if (set.has(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    clusters.push(cluster.sort((a, b) => a - b));
  }
  return clusters;
}

const CLUSTER_THRESHOLD = 20;

/** Compute the bounding box of a cluster of plot ids. */
function clusterBBox(ids: number[]): Zone {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const id of ids) {
    const { x, y } = xyFromPlotId(id);
    if (x < x1) x1 = x;
    if (y < y1) y1 = y;
    if (x > x2) x2 = x;
    if (y > y2) y2 = y;
  }
  return { x1, y1, x2, y2 };
}

/** Validate an image reference (data URI, ipfs://, or a direct image URL). */
function validateImageRef(ref: string): string | null {
  const v = ref.trim();
  if (!v) return "Add an image — choose a file or paste a URL";
  if (v.startsWith("data:image/")) {
    if (v.length > MAX_ONCHAIN_IMAGE_BYTES)
      return "Image is too large to store on-chain";
    return null;
  }
  if (v.startsWith("ipfs://")) return null;
  if (!/^https?:\/\//i.test(v))
    return "Must start with https://, http:// or ipfs://";
  if (!IMAGE_EXT.test(v))
    return "URL must end in .png, .jpg, .jpeg, .webp or .gif";
  return null;
}

/** Resolve ipfs:// for an <img> preview. */
function previewSrc(ref: string): string {
  if (ref.startsWith("ipfs://"))
    return `https://ipfs.io/ipfs/${ref.slice("ipfs://".length)}`;
  return ref;
}

/** Turn a raw wallet/tx error into a short, human message. */
function friendlyTxError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/user rejected|rejected the request|user denied|denied/i.test(msg))
    return "Transaction cancelled in your wallet";
  if (/insufficient funds|insufficient resources|exceeds the balance/i.test(msg))
    return "Insufficient ETH to cover gas for this transaction";
  if (/not plot owner/i.test(msg))
    return "You don't own this pixel anymore — refresh your profile";
  if (/estimate gas|reverted|execution reverted|user ?operation/i.test(msg))
    return "The wallet couldn't run this transaction — your image may be too large or you no longer own this pixel";
  return msg.slice(0, 140);
}

type MinimalPublicClient = {
  readContract: (args: unknown) => Promise<unknown>;
};

/**
 * Validate an `updatePlotImage` call *before* it reaches the wallet.
 * Only checks size and on-chain ownership — no gas simulation.
 */
async function preflightImageUpdate(
  publicClient: MinimalPublicClient | null | undefined,
  contract: `0x${string}`,
  account: `0x${string}` | undefined,
  plotId: number,
  uri: string,
): Promise<string | null> {
  if (!account) return "Connect your wallet first";
  const v = uri.trim();
  if (!v) return "Add an image before saving";
  if (v.length > MAX_ONCHAIN_IMAGE_BYTES)
    return "Image is too large to store on-chain — try a simpler one";
  if (!publicClient) return null;
  try {
    const plot = (await readContractWithTimeout(
      publicClient.readContract({
        address: contract,
        abi: baseBoardAbi,
        functionName: "getPlot",
        args: [BigInt(plotId)],
      }),
    )) as Plot | undefined;
    if (!plot || plot.owner.toLowerCase() !== account.toLowerCase())
      return "You no longer own this pixel — refresh your profile and try again";

    return null;
  } catch (e) {
    return friendlyTxError(e);
  }
}

export function ProfileDrawer() {
  const profileOpen = useBoardStore((s) => s.profileOpen);
  const setProfileOpen = useBoardStore((s) => s.setProfileOpen);
  const refreshNonce = useBoardStore((s) => s.refreshNonce);
  const { address, isConnected } = useAccount();
  const baseName = useBaseName(address);
  const publicClient = usePublicClient();
  const cfg = useActiveChainConfig();
  const { ids, isLoading } = usePlotsByOwner(address);

  const [details, setDetails] = useState<Record<number, Plot>>({});
  const [multiMode, setMultiMode] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);

  const toggleSelected = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((i) => i !== id) : [...s, id]));

  const toggleCluster = (cluster: number[]) =>
    setSelected((s) => {
      const all = cluster.every((id) => s.includes(id));
      if (all) return s.filter((id) => !cluster.includes(id));
      const next = new Set(s);
      cluster.forEach((id) => next.add(id));
      return Array.from(next);
    });

  useEffect(() => {
    if (!profileOpen) {
      setMultiMode(false);
      setSelected([]);
    }
  }, [profileOpen]);

  useEffect(() => {
    if (!cfg.isConfigured || !publicClient || ids.length === 0) {
      setDetails({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = (await readContractWithTimeout(
          publicClient.readContract({
            address: cfg.contract,
            abi: baseBoardAbi,
            functionName: "getPlotsBatch",
            args: [ids.map((i) => BigInt(i))],
          }),
        )) as readonly Plot[];
        if (cancelled) return;
        const map: Record<number, Plot> = {};
        result.forEach((p, i) => {
          map[ids[i]] = p;
        });
        setDetails(map);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(","), refreshNonce, cfg.contract, cfg.isConfigured]);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-slate-900/30 transition-opacity ${
          profileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setProfileOpen(false)}
      />

      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l-4 border-base-blue bg-white shadow-2xl transition-transform duration-300 ${
          profileOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="border-b-2 border-blue-100 px-5 py-4">
          <button
            type="button"
            onClick={() => setProfileOpen(false)}
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
            <div>
              <h2 className="text-xl font-black text-base-blue">My Profile</h2>
              {isConnected && (
                <p className="font-mono text-xs text-slate-500">
                  {baseName ?? shortAddress(address)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setProfileOpen(false)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              aria-label="close profile"
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

        <div className="thin-scrollbar flex-1 overflow-y-auto p-4">
          {!isConnected ? (
            <div className="mt-10 flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-slate-500">
                Connect your wallet to view and manage your pixels.
              </p>
              <WalletConnect />
            </div>
          ) : !cfg.isConfigured ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              No BaseBoard contract is configured on {cfg.name}. Deploy
              BaseBoard.sol on this network to manage your pixels here.
            </p>
          ) : isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner size={16} /> Loading your pixels…
            </div>
          ) : ids.length === 0 ? (
            <div className="mt-10 text-center text-sm text-slate-500">
              You don&apos;t own any pixels yet. Close this panel and buy some on
              the board!
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-600">
                  {ids.length} pixel{ids.length === 1 ? "" : "s"} owned
                </p>
                {ids.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setMultiMode((m) => !m);
                      setSelected([]);
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                      multiMode
                        ? "bg-base-blue text-white"
                        : "border-2 border-base-blue text-base-blue hover:bg-blue-50"
                    }`}
                  >
                    {multiMode ? "Done" : "＋ One image, many pixels"}
                  </button>
                )}
              </div>

              {multiMode && (
                <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-base-blue">
                  Tap the pixels you want to cover, then upload a single image —
                  it spans the whole selection in one transaction. Use a batch
                  master checkbox to select a whole purchase block at once.
                </p>
              )}

              {multiMode
                ? (() => {
                    const clusters = clusterize(ids);
                    return clusters.map((cluster, ci) => {
                      const isLarge = cluster.length >= 20;
                      if (isLarge) {
                        const allChecked = cluster.every((id) =>
                          selected.includes(id),
                        );
                        const bbox = clusterBBox(cluster);
                        const anchorId = Math.min(...cluster);
                        return (
                          <label
                            key={`batch-${anchorId}`}
                            className="flex cursor-pointer items-center gap-2 rounded-xl border-2 border-base-blue/30 bg-blue-50/30 px-3 py-2 text-xs font-bold text-base-blue"
                          >
                            <input
                              type="checkbox"
                              checked={allChecked}
                              onChange={() => toggleCluster(cluster)}
                              className="h-4 w-4 accent-base-blue shrink-0"
                            />
                            <span>
                              Batch #{ci + 1} · {cluster.length} pixels ({bbox.x1}–{bbox.x2}, {bbox.y1}–{bbox.y2})
                            </span>
                          </label>
                        );
                      }
                      const allChecked = cluster.every((id) =>
                        selected.includes(id),
                      );
                      const someChecked = cluster.some((id) =>
                        selected.includes(id),
                      );
                      return (
                        <div
                          key={`batch-${cluster[0]}`}
                          className="rounded-xl border-2 border-blue-100 p-2"
                        >
                          <label className="mb-1 flex cursor-pointer items-center gap-2 px-1 py-1 text-xs font-bold text-base-blue">
                            <input
                              type="checkbox"
                              checked={allChecked}
                              ref={(el) => {
                                if (el)
                                  el.indeterminate = !allChecked && someChecked;
                              }}
                              onChange={() => toggleCluster(cluster)}
                              className="h-4 w-4 accent-base-blue"
                            />
                            Batch #{ci + 1} · {cluster.length} pixel
                            {cluster.length === 1 ? "" : "s"}
                            {cluster.length > 1 ? " (adjacent)" : ""}
                          </label>
                          <div className="space-y-2">
                            {cluster.map((id) => (
                              <OwnedPlotRow
                                key={id}
                                plotId={id}
                                plot={details[id]}
                                selectable
                                checked={selected.includes(id)}
                                onToggle={() => toggleSelected(id)}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    });
                  })()
                : (() => {
                    const CLUSTER_THRESHOLD = 20;
                    const clusters = clusterize(ids);
                    const rows: React.ReactNode[] = [];
                    for (const cluster of clusters) {
                      if (cluster.length >= CLUSTER_THRESHOLD) {
                        const bbox = clusterBBox(cluster);
                        const anchorId = Math.min(...cluster);
                        rows.push(
                          <LargeClusterRow
                            key={`cluster-${anchorId}`}
                            cluster={cluster}
                            clusterIds={cluster}
                            bbox={bbox}
                            anchorPlot={details[anchorId]}
                          />,
                        );
                      } else {
                        for (const id of cluster) {
                          rows.push(
                            <OwnedPlotRow
                              key={id}
                              plotId={id}
                              plot={details[id]}
                              selectable={false}
                              checked={selected.includes(id)}
                              onToggle={() => toggleSelected(id)}
                            />,
                          );
                        }
                      }
                    }
                    return rows;
                  })()}
            </div>
          )}
        </div>

        {multiMode && selected.length > 0 && (
          <MultiImagePanel
            selected={selected}
            onDone={() => {
              setSelected([]);
              setMultiMode(false);
            }}
          />
        )}
      </aside>
    </>
  );
}

type Action = "none" | "list" | "price" | "image";

function OwnedPlotRow({
  plotId,
  plot,
  selectable,
  checked,
  onToggle,
}: {
  plotId: number;
  plot?: Plot;
  selectable: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const { x, y } = xyFromPlotId(plotId);
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const cfg = useActiveChainConfig();
  const setFocusPlotId = useBoardStore((s) => s.setFocusPlotId);
  const setProfileOpen = useBoardStore((s) => s.setProfileOpen);
  const pushToast = useBoardStore((s) => s.pushToast);
  const applyOptimisticPlots = useBoardStore((s) => s.applyOptimisticPlots);
  const { writeContractAsync, setPendingTxLabel, status, isSuccess, error } =
    useBaseBoardWrite();

  const [action, setAction] = useState<Action>("none");
  const [priceInput, setPriceInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  // Plot override to push onto the board the moment the tx confirms, so the
  // change shows instantly without waiting for the next on-chain re-read.
  const pendingOverrideRef = useRef<Record<number, Plot> | null>(null);

  const busy = status === "pending" || status === "confirming";

  useEffect(() => {
    if (isSuccess && pendingLabel) {
      if (pendingOverrideRef.current) {
        applyOptimisticPlots(pendingOverrideRef.current);
        pendingOverrideRef.current = null;
      }
      pushToast("success", `${pendingLabel} confirmed`);
      setPendingLabel(null);
      setAction("none");
    }
  }, [isSuccess, pendingLabel, pushToast, applyOptimisticPlots]);

  const submit = async (label: string, fn: () => Promise<unknown>) => {
    setLocalError(null);
    setPendingLabel(label);
    setPendingTxLabel(label);
    try {
      await fn();
      pushToast("info", `${label} submitted — waiting for confirmation…`);
    } catch (e) {
      setPendingLabel(null);
      const m = friendlyTxError(e);
      setLocalError(m);
      pushToast("error", m);
    }
  };

  const parsePrice = (): bigint | null => {
    try {
      const v = parseEther(priceInput || "0");
      if (v <= 0n) throw new Error("zero");
      return v;
    } catch {
      setLocalError("Enter a valid ETH price");
      return null;
    }
  };

  /** Build a single-plot optimistic override from the current plot + changes. */
  const override = (changes: Partial<Plot>): Record<number, Plot> => ({
    [plotId]: {
      owner: (address ?? plot?.owner ?? ZERO_ADDRESS) as `0x${string}`,
      price: plot?.price ?? 0n,
      isForSale: plot?.isForSale ?? false,
      imageUri: plot?.imageUri ?? "",
      ...changes,
    },
  });

  const onList = () => {
    const v = parsePrice();
    if (v == null) return;
    pendingOverrideRef.current = override({ isForSale: true, price: v });
    void submit("Listing", () =>
      writeContractAsync({
        address: cfg.contract,
        abi: baseBoardAbi,
        functionName: "listPlot",
        args: [BigInt(plotId), v],
      }),
    );
  };

  const onUpdatePrice = () => {
    const v = parsePrice();
    if (v == null) return;
    pendingOverrideRef.current = override({ isForSale: true, price: v });
    void submit("Price update", () =>
      writeContractAsync({
        address: cfg.contract,
        abi: baseBoardAbi,
        functionName: "updatePlotPrice",
        args: [BigInt(plotId), v],
      }),
    );
  };

  const onCancel = () => {
    pendingOverrideRef.current = override({ isForSale: false, price: 0n });
    void submit("Cancel listing", () =>
      writeContractAsync({
        address: cfg.contract,
        abi: baseBoardAbi,
        functionName: "cancelListing",
        args: [BigInt(plotId)],
      }),
    );
  };

  const onSaveImage = async (uri: string, link?: string | null) => {
    const finalUri = withMeta(uri.trim(), { link });
    const problem = await preflightImageUpdate(
      publicClient as MinimalPublicClient | undefined,
      cfg.contract,
      address,
      plotId,
      finalUri,
    );
    if (problem) {
      setLocalError(problem);
      pushToast("error", problem);
      return;
    }
    // Let the wallet estimate gas: storing a (now tiny) data URI still costs far
    // more than a flat 21k-style limit, so a hardcoded cap would itself revert.
    pendingOverrideRef.current = override({ imageUri: finalUri });
    await submit("Image update", () =>
      writeContractAsync({
        address: cfg.contract,
        abi: baseBoardAbi,
        functionName: "updatePlotImage",
        args: [BigInt(plotId), finalUri],
      }),
    );
  };

  if (selectable) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition ${
          checked
            ? "border-base-blue bg-blue-50"
            : "border-blue-100 hover:border-base-blue/50"
        }`}
      >
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${
            checked ? "border-base-blue bg-base-blue" : "border-slate-300"
          }`}
        >
          {checked && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M20 6L9 17l-5-5"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
        {plot?.imageUri ? (
          <img
            src={previewSrc(plot.imageUri)}
            alt=""
            className="h-9 w-9 shrink-0 rounded-md border border-blue-100 object-cover"
          />
        ) : (
          <span className="h-9 w-9 shrink-0 rounded-md border border-blue-100 bg-blue-50" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-base-blue">
            ({x}, {y})
          </span>
          <span className="block text-xs text-slate-500">id #{plotId}</span>
        </span>
      </button>
    );
  }

  return (
    <div className="rounded-xl border-2 border-blue-100 p-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            setFocusPlotId(plotId);
            setProfileOpen(false);
          }}
          className="text-left"
        >
          <p className="font-bold text-base-blue hover:underline">
            ({x}, {y})
          </p>
          <p className="text-xs text-slate-500">id #{plotId}</p>
        </button>
        <div className="text-right text-xs">
          {plot?.isForSale ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-700">
              Listed · {formatEther(plot.price)} ETH
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-500">
              Not listed
            </span>
          )}
        </div>
      </div>

      {plot?.imageUri && (
        <img
          src={previewSrc(plot.imageUri)}
          alt="plot"
          className="mt-2 h-20 w-full rounded-lg border border-blue-100 object-cover"
        />
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!plot?.isForSale ? (
          <ActionButton
            active={action === "list"}
            onClick={() => setAction(action === "list" ? "none" : "list")}
          >
            List for Sale
          </ActionButton>
        ) : (
          <>
            <ActionButton
              active={action === "price"}
              onClick={() => setAction(action === "price" ? "none" : "price")}
            >
              Update Price
            </ActionButton>
            <ActionButton onClick={onCancel} variant="danger" disabled={busy}>
              Cancel Listing
            </ActionButton>
          </>
        )}
        <ActionButton
          active={action === "image"}
          onClick={() => setAction(action === "image" ? "none" : "image")}
        >
          {plot?.imageUri ? "Update Image" : "Upload Image"}
        </ActionButton>
      </div>

      {(action === "list" || action === "price") && (
        <div className="mt-3 flex gap-2">
          <input
            type="number"
            min="0"
            step="0.00001"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder="Price in ETH"
            className="w-full rounded-lg border-2 border-blue-100 px-3 py-1.5 text-sm focus:border-base-blue focus:outline-none"
          />
          <PrimaryButton
            onClick={action === "list" ? onList : onUpdatePrice}
            busy={busy}
            disabled={busy || !priceInput}
          >
            {action === "list" ? "List" : "Update"}
          </PrimaryButton>
        </div>
      )}

      {action === "image" && (
        <div className="mt-3">
          <ImageUploader
            initialValue={plot?.imageUri ?? ""}
            busy={busy}
            onSave={onSaveImage}
            aspect={1}
            maxDim={dimForPlots(1, 1)}
          />
        </div>
      )}

      {localError && (
        <p className="mt-2 break-words text-xs font-medium text-red-600">
          {localError}
        </p>
      )}
      {!localError && error && status === "error" && (
        <p className="mt-2 break-words text-xs font-medium text-red-600">
          {friendlyTxError(error)}
        </p>
      )}
    </div>
  );
}

function MultiImagePanel({
  selected,
  onDone,
}: {
  selected: number[];
  onDone: () => void;
}) {
  const pushToast = useBoardStore((s) => s.pushToast);
  const applyOptimisticPlots = useBoardStore((s) => s.applyOptimisticPlots);
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const cfg = useActiveChainConfig();
  const { writeContractAsync, setPendingTxLabel, status, isSuccess } =
    useBaseBoardWrite();
  const [pending, setPending] = useState(false);
  const pendingOverrideRef = useRef<Record<number, Plot> | null>(null);

  const busy = pending || status === "pending" || status === "confirming";

  const zone = useMemo<Zone>(() => {
    const pts = selected.map((id) => xyFromPlotId(id));
    return {
      x1: Math.min(...pts.map((p) => p.x)),
      y1: Math.min(...pts.map((p) => p.y)),
      x2: Math.max(...pts.map((p) => p.x)),
      y2: Math.max(...pts.map((p) => p.y)),
    };
  }, [selected]);

  const plotsW = zone.x2 - zone.x1 + 1;
  const plotsH = zone.y2 - zone.y1 + 1;

  const anchorId = useMemo(() => Math.min(...selected), [selected]);

  useEffect(() => {
    if (isSuccess && pending) {
      if (pendingOverrideRef.current) {
        applyOptimisticPlots(pendingOverrideRef.current);
        pendingOverrideRef.current = null;
      }
      pushToast("success", `Image applied across ${selected.length} pixels`);
      setPending(false);
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  const onApply = async (uri: string, link?: string | null) => {
    const finalUri = withMeta(uri, { zone, link });
    const problem = await preflightImageUpdate(
      publicClient as MinimalPublicClient | undefined,
      cfg.contract,
      address,
      anchorId,
      finalUri,
    );
    if (problem) {
      pushToast("error", problem);
      return;
    }
    // The image lives on the anchor plot with a `#bb` zone fragment; the canvas
    // spans it across the whole selection. Render it optimistically on confirm.
    pendingOverrideRef.current = {
      [anchorId]: {
        owner: (address ?? ZERO_ADDRESS) as `0x${string}`,
        price: 0n,
        isForSale: false,
        imageUri: finalUri,
      },
    };
    setPending(true);
    setPendingTxLabel("Image update");
    try {
      await writeContractAsync({
        address: cfg.contract,
        abi: baseBoardAbi,
        functionName: "updatePlotImage",
        args: [BigInt(anchorId), finalUri],
      });
      pushToast("info", "Image submitted — waiting for confirmation…");
    } catch (e) {
      setPending(false);
      pendingOverrideRef.current = null;
      pushToast("error", friendlyTxError(e));
    }
  };

  return (
    <div className="thin-scrollbar max-h-[55vh] shrink-0 touch-pan-y overflow-y-auto overscroll-contain border-t-2 border-blue-100 bg-white p-4 shadow-[0_-8px_20px_rgba(0,82,255,0.06)]">
      <p className="mb-2 text-sm font-bold text-base-blue">
        {selected.length} pixel{selected.length === 1 ? "" : "s"} selected ·{" "}
        {plotsW}×{plotsH} area
      </p>
      <ImageUploader
        busy={busy}
        onSave={onApply}
        saveLabel="Apply to selection"
        aspect={plotsW / plotsH}
        maxDim={dimForPlots(plotsW, plotsH)}
      />
    </div>
  );
}

/** Summary row for a large cluster (>=20 pixels). */
function LargeClusterRow({
  cluster,
  bbox,
  anchorPlot,
}: {
  cluster: number[];
  bbox: Zone;
  anchorPlot?: Plot;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const cfg = useActiveChainConfig();
  const setFocusPlotId = useBoardStore((s) => s.setFocusPlotId);
  const setProfileOpen = useBoardStore((s) => s.setProfileOpen);
  const pushToast = useBoardStore((s) => s.pushToast);
  const applyOptimisticPlots = useBoardStore((s) => s.applyOptimisticPlots);
  const { writeContractAsync, setPendingTxLabel, status, isSuccess, error } =
    useBaseBoardWrite();

  const [action, setAction] = useState<"none" | "list" | "price" | "image">("none");
  const [priceInput, setPriceInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [splitConfig, setSplitConfig] = useState<{ cols: number; rows: number } | null>(null);
  const pendingOverrideRef = useRef<Record<number, Plot> | null>(null);

  const busy = status === "pending" || status === "confirming";
  const anchorId = Math.min(...cluster);
  const bboxW = bbox.x2 - bbox.x1 + 1;
  const bboxH = bbox.y2 - bbox.y1 + 1;

  useEffect(() => {
    if (isSuccess && pendingLabel) {
      if (pendingOverrideRef.current) {
        applyOptimisticPlots(pendingOverrideRef.current);
        pendingOverrideRef.current = null;
      }
      pushToast("success", `${pendingLabel} confirmed`);
      setPendingLabel(null);
      setAction("none");
    }
  }, [isSuccess, pendingLabel, pushToast, applyOptimisticPlots]);

  const submit = async (label: string, fn: () => Promise<unknown>) => {
    setLocalError(null);
    setPendingLabel(label);
    setPendingTxLabel(label);
    try {
      await fn();
      pushToast("info", `${label} submitted — waiting for confirmation…`);
    } catch (e) {
      setPendingLabel(null);
      const m = friendlyTxError(e);
      setLocalError(m);
      pushToast("error", m);
    }
  };

  const parsePrice = (): bigint | null => {
    try {
      const v = parseEther(priceInput || "0");
      if (v <= 0n) throw new Error("zero");
      return v;
    } catch {
      setLocalError("Enter a valid ETH price");
      return null;
    }
  };

  const override = (changes: Partial<Plot>): Record<number, Plot> => ({
    [anchorId]: {
      owner: (address ?? anchorPlot?.owner ?? ZERO_ADDRESS) as `0x${string}`,
      price: anchorPlot?.price ?? 0n,
      isForSale: anchorPlot?.isForSale ?? false,
      imageUri: anchorPlot?.imageUri ?? "",
      ...changes,
    },
  });

  const onList = () => {
    const v = parsePrice();
    if (v == null) return;
    pendingOverrideRef.current = override({ isForSale: true, price: v });
    void submit("Listing", () =>
      writeContractAsync({
        address: cfg.contract,
        abi: baseBoardAbi,
        functionName: "listPlot",
        args: [BigInt(anchorId), v],
      }),
    );
  };

  const onUpdatePrice = () => {
    const v = parsePrice();
    if (v == null) return;
    pendingOverrideRef.current = override({ isForSale: true, price: v });
    void submit("Price update", () =>
      writeContractAsync({
        address: cfg.contract,
        abi: baseBoardAbi,
        functionName: "updatePlotPrice",
        args: [BigInt(anchorId), v],
      }),
    );
  };

  const onCancel = () => {
    pendingOverrideRef.current = override({ isForSale: false, price: 0n });
    void submit("Cancel listing", () =>
      writeContractAsync({
        address: cfg.contract,
        abi: baseBoardAbi,
        functionName: "cancelListing",
        args: [BigInt(anchorId)],
      }),
    );
  };

  const onSaveImage = async (uri: string, link?: string | null) => {
    const finalUri = withMeta(uri.trim(), { zone: bbox, link });
    const problem = await preflightImageUpdate(
      publicClient as MinimalPublicClient | undefined,
      cfg.contract,
      address,
      anchorId,
      finalUri,
    );
    if (problem) {
      setLocalError(problem);
      pushToast("error", problem);
      return;
    }
    pendingOverrideRef.current = {
      ...override({ imageUri: finalUri }),
      ...Object.fromEntries(
        cluster
          .filter((id) => id !== anchorId)
          .map((id) => [
            id,
            { owner: ZERO_ADDRESS as `0x${string}`, price: 0n, isForSale: false, imageUri: "" },
          ]),
      ),
    };
    await submit("Image update", () =>
      writeContractAsync({
        address: cfg.contract,
        abi: baseBoardAbi,
        functionName: "updatePlotImage",
        args: [BigInt(anchorId), finalUri],
      }),
    );
  };

  // Split presets
  const splitPresets = useMemo(() => {
    const presets: Array<{ cols: number; rows: number; label: string }> = [];
    if (bboxW >= 2) presets.push({ cols: 2, rows: 1, label: "2×1" });
    if (bboxH >= 2) presets.push({ cols: 1, rows: 2, label: "1×2" });
    if (bboxW >= 2 && bboxH >= 2) presets.push({ cols: 2, rows: 2, label: "2×2" });
    if (bboxW >= 4) presets.push({ cols: 4, rows: 1, label: "4×1" });
    return presets;
  }, [bboxW, bboxH]);

  const [subImages, setSubImages] = useState<Record<string, string>>({});

  const handleSubImage = async (subKey: string, uri: string, link: string | null | undefined, subZone: Zone) => {
    const finalUri = withMeta(uri.trim(), { zone: subZone, link });
    const subAnchorId = subZone.x1 + subZone.y1 * GRID_SIZE;
    const problem = await preflightImageUpdate(
      publicClient as MinimalPublicClient | undefined,
      cfg.contract,
      address,
      subAnchorId,
      finalUri,
    );
    if (problem) {
      pushToast("error", problem);
      return;
    }
    pendingOverrideRef.current = { [subAnchorId]: {
      owner: (address ?? ZERO_ADDRESS) as `0x${string}`,
      price: 0n,
      isForSale: false,
      imageUri: finalUri,
    }};
    await submit(`Image for section ${subKey}`, () =>
      writeContractAsync({
        address: cfg.contract,
        abi: baseBoardAbi,
        functionName: "updatePlotImage",
        args: [BigInt(subAnchorId), finalUri],
      }),
    );
    setSubImages((s) => ({ ...s, [subKey]: uri }));
  };

  const subZones = useMemo<Array<{ key: string; zone: Zone }>>(() => {
    if (!splitConfig) return [];
    const { cols, rows } = splitConfig;
    const cellW = bboxW / cols;
    const cellH = bboxH / rows;
    const zones: Array<{ key: string; zone: Zone }> = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sx1 = bbox.x1 + Math.floor(c * cellW);
        const sy1 = bbox.y1 + Math.floor(r * cellH);
        const sx2 = c === cols - 1 ? bbox.x2 : bbox.x1 + Math.floor((c + 1) * cellW) - 1;
        const sy2 = r === rows - 1 ? bbox.y2 : bbox.y1 + Math.floor((r + 1) * cellH) - 1;
        zones.push({
          key: `${cols}x${rows}-${c}-${r}`,
          zone: { x1: sx1, y1: sy1, x2: sx2, y2: sy2 },
        });
      }
    }
    return zones;
  }, [splitConfig, bboxW, bboxH, bbox]);

  return (
    <div className="rounded-xl border-2 border-base-blue/30 bg-blue-50/30 p-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            setFocusPlotId(anchorId);
            setProfileOpen(false);
          }}
          className="text-left"
        >
          <p className="font-bold text-base-blue hover:underline">
            ({bbox.x1}–{bbox.x2}, {bbox.y1}–{bbox.y2})
          </p>
          <p className="text-xs text-slate-500">
            {bboxW}×{bboxH} area · {cluster.length} pixels
          </p>
        </button>
        <div className="text-right text-xs">
          {anchorPlot?.isForSale ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-700">
              Listed · {formatEther(anchorPlot.price)} ETH
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-500">
              Not listed
            </span>
          )}
        </div>
      </div>

      {anchorPlot?.imageUri && (
        <img
          src={previewSrc(anchorPlot.imageUri)}
          alt="cluster"
          className="mt-2 h-20 w-full rounded-lg border border-blue-100 object-cover"
        />
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!anchorPlot?.isForSale ? (
          <ActionButton
            active={action === "list"}
            onClick={() => setAction(action === "list" ? "none" : "list")}
          >
            List for Sale
          </ActionButton>
        ) : (
          <>
            <ActionButton
              active={action === "price"}
              onClick={() => setAction(action === "price" ? "none" : "price")}
            >
              Update Price
            </ActionButton>
            <ActionButton onClick={onCancel} variant="danger" disabled={busy}>
              Cancel Listing
            </ActionButton>
          </>
        )}
        <ActionButton
          active={action === "image"}
          onClick={() => {
            setAction(action === "image" ? "none" : "image");
            setSplitMode(false);
            setSplitConfig(null);
          }}
        >
          {anchorPlot?.imageUri ? "Update Image" : "Upload Image"}
        </ActionButton>
      </div>

      {(action === "list" || action === "price") && (
        <div className="mt-3 flex gap-2">
          <input
            type="number"
            min="0"
            step="0.00001"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder="Price in ETH"
            className="w-full rounded-lg border-2 border-blue-100 px-3 py-1.5 text-sm focus:border-base-blue focus:outline-none"
          />
          <PrimaryButton
            onClick={action === "list" ? onList : onUpdatePrice}
            busy={busy}
            disabled={busy || !priceInput}
          >
            {action === "list" ? "List" : "Update"}
          </PrimaryButton>
        </div>
      )}

      {action === "image" && (
        <div className="mt-3 space-y-3">
          <ImageUploader
            initialValue={anchorPlot?.imageUri ?? ""}
            busy={busy}
            onSave={onSaveImage}
            aspect={bboxW / bboxH}
            maxDim={dimForPlots(bboxW, bboxH)}
          />

          <div className="border-t border-blue-100 pt-3">
            <button
              type="button"
              onClick={() => setSplitMode(!splitMode)}
              className="rounded-lg border-2 border-base-blue px-3 py-1.5 text-xs font-semibold text-base-blue hover:bg-blue-50"
            >
              {splitMode ? "Hide split options" : "Split into sections"}
            </button>

            {splitMode && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {splitPresets.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() =>
                        setSplitConfig(
                          splitConfig?.cols === p.cols && splitConfig.rows === p.rows
                            ? null
                            : { cols: p.cols, rows: p.rows },
                        )
                      }
                      className={`rounded-lg border-2 px-2.5 py-1 text-xs font-semibold transition ${
                        splitConfig?.cols === p.cols && splitConfig.rows === p.rows
                          ? "border-base-blue bg-base-blue text-white"
                          : "border-blue-200 text-base-blue hover:bg-blue-50"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {splitConfig && (
                  <div className="space-y-4">
                    <p className="text-xs font-medium text-slate-500">
                      {subZones.length} sections — upload an independent image for each:
                    </p>
                    {subZones.map((sz) => (
                      <div key={sz.key} className="rounded-lg border border-blue-100 p-2">
                        <p className="mb-1 text-xs font-semibold text-base-blue">
                          Section ({sz.zone.x1}–{sz.zone.x2}, {sz.zone.y1}–{sz.zone.y2})
                        </p>
                        <ImageUploader
                          initialValue={subImages[sz.key] ?? ""}
                          busy={busy}
                          onSave={(uri, link) => handleSubImage(sz.key, uri, link, sz.zone)}
                          aspect={
                            (sz.zone.x2 - sz.zone.x1 + 1) / (sz.zone.y2 - sz.zone.y1 + 1)
                          }
                          maxDim={dimForPlots(
                            sz.zone.x2 - sz.zone.x1 + 1,
                            sz.zone.y2 - sz.zone.y1 + 1,
                          )}
                          saveLabel="Upload to section"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {localError && (
        <p className="mt-2 break-words text-xs font-medium text-red-600">
          {localError}
        </p>
      )}
      {!localError && error && status === "error" && (
        <p className="mt-2 break-words text-xs font-medium text-red-600">
          {friendlyTxError(error)}
        </p>
      )}
    </div>
  );
}

function ImageUploader({
  initialValue = "",
  busy,
  onSave,
  saveLabel = "Save Image",
  aspect,
  maxDim,
}: {
  initialValue?: string;
  busy: boolean;
  onSave: (uri: string, link?: string | null) => void | Promise<void>;
  saveLabel?: string;
  aspect?: number;
  maxDim?: number;
}) {
  const [value, setValue] = useState(() => stripZone(initialValue));
  const [link, setLink] = useState(() => parseLink(initialValue) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);

  const isData = value.startsWith("data:");

  const onPickFile = async (file: File | undefined, input: HTMLInputElement) => {
    setError(null);
    setInfo(null);
    input.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `That file is ${(file.size / (1024 * 1024)).toFixed(
          1,
        )} MB — the maximum upload size is 20 MB.`,
      );
      return;
    }
    const content = validateImageContent(file);
    if (!content.ok) {
      setError(
        "Explicit or restricted image content detected. Please choose a different image.",
      );
      return;
    }
    setCompressing(true);
    setValue("");
    try {
      const res = await compressImageFile(file, { aspect, maxDim });
      if (res.tooLarge) {
        setError(
          `That image is too detailed for on-chain storage (${(
            res.bytes / 1024
          ).toFixed(1)} KB). Try a simpler picture or paste a hosted URL.`,
        );
      } else {
        setValue(res.dataUri);
        setInfo(
          `Ready · ${(res.bytes / 1024).toFixed(1)} KB · ${res.width}×${res.height}`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not process that image");
    } finally {
      setCompressing(false);
    }
  };

  const validationError = validateImageRef(value);
  const linkCheck = validateLinkUrl(link);
  const ready =
    !busy && !compressing && validationError === null && linkCheck.ok;

  const handleSave = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!linkCheck.ok) {
      setError(
        "Invalid or restricted URL layout detected. Please provide a safe destination link.",
      );
      return;
    }
    setError(null);
    await onSave(value.trim(), linkCheck.url ?? null);
  };

  return (
    <div className="space-y-2.5">
      <label className="group flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/40 px-3 py-4 text-center transition hover:border-base-blue hover:bg-blue-50">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 16V4m0 0L8 8m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
            stroke="#0052ff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-xs font-bold text-base-blue">
          Upload from device
        </span>
        <span className="text-[10px] text-slate-500">
          Camera or gallery · auto-optimized for the chain
        </span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files?.[0], e.currentTarget)}
        />
      </label>

      <div className="flex items-center gap-2">
        <span className="h-px flex-1 bg-blue-100" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          or paste a URL
        </span>
        <span className="h-px flex-1 bg-blue-100" />
      </div>

      <input
        type="text"
        value={isData ? "" : value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
          setInfo(null);
        }}
        placeholder="https://….png · .jpg · .webp · .gif · ipfs://CID"
        className="w-full rounded-lg border-2 border-blue-100 px-3 py-1.5 text-sm focus:border-base-blue focus:outline-none"
      />

      {compressing && (
        <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <Spinner size={13} /> Optimizing image…
        </p>
      )}
      {info && !error && (
        <p className="text-xs font-semibold text-green-600">{info}</p>
      )}

      {value && !error && !compressing && (
        <img
          src={previewSrc(value)}
          alt="preview"
          className="w-full rounded-lg border border-blue-100 bg-slate-50 object-contain"
          style={
            aspect
              ? { aspectRatio: String(aspect), maxHeight: "14rem" }
              : { height: "7rem" }
          }
          onError={() => setError("That image could not be loaded")}
        />
      )}

      <div className="space-y-1 pt-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Link (optional)
        </label>
        <input
          type="url"
          inputMode="url"
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setError(null);
          }}
          placeholder="https://your-site.com — opens when the pixel is clicked"
          className={`w-full rounded-lg border-2 px-3 py-1.5 text-sm focus:outline-none ${
            link && !linkCheck.ok
              ? "border-red-300 focus:border-red-400"
              : "border-blue-100 focus:border-base-blue"
          }`}
        />
        {link && !linkCheck.ok && (
          <p className="text-[11px] font-medium text-red-600">
            Invalid or restricted URL layout detected. Please provide a safe
            destination link.
          </p>
        )}
      </div>

      {error && (
        <p className="break-words text-xs font-medium text-red-600">{error}</p>
      )}

      <PrimaryButton onClick={handleSave} busy={busy} disabled={!ready} full>
        {saveLabel}
      </PrimaryButton>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  variant = "default",
  active = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "danger";
  active?: boolean;
  disabled?: boolean;
}) {
  const base =
    "rounded-lg border-2 px-2.5 py-1 text-xs font-semibold transition disabled:opacity-40";
  const styles =
    variant === "danger"
      ? "border-red-200 text-red-600 hover:bg-red-50"
      : active
        ? "border-base-blue bg-base-blue text-white"
        : "border-base-blue text-base-blue hover:bg-blue-50";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles}`}
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  children,
  onClick,
  busy = false,
  disabled = false,
  full = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  full?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold transition ${
        full ? "w-full" : ""
      } ${
        disabled
          ? "cursor-not-allowed bg-slate-200 text-slate-400"
          : "bg-base-blue text-white hover:bg-base-dark"
      }`}
    >
      {busy && <Spinner size={14} className="!border-white/40 !border-t-white" />}
      {children}
    </button>
  );
}
