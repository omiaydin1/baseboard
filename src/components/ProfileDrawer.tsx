"use client";

import { useEffect, useMemo, useState } from "react";
import { formatEther, parseEther } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { Spinner } from "./Spinner";
import { WalletConnect } from "./WalletConnect";
import { useBoardStore } from "@/store/useBoardStore";
import { usePlotsByOwner, useBaseBoardWrite } from "@/hooks/useBaseBoard";
import { baseBoardAbi, baseBoardAddress } from "@/lib/contract";
import { IS_CONTRACT_CONFIGURED } from "@/lib/constants";
import { shortAddress, xyFromPlotId } from "@/lib/coords";
import {
  MAX_ONCHAIN_IMAGE_BYTES,
  compressImageFile,
  withZone,
  type Zone,
} from "@/lib/image";
import type { Plot } from "@/lib/types";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)(\?.*)?$/i;

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
    return "You don't own this plot anymore — refresh your profile";
  if (/estimate gas|reverted|execution reverted|user ?operation/i.test(msg))
    return "The wallet couldn't run this transaction — your image may be too large or you no longer own this plot";
  return msg.slice(0, 140);
}

type MinimalPublicClient = {
  readContract: (args: unknown) => Promise<unknown>;
  simulateContract: (args: unknown) => Promise<unknown>;
};

/**
 * Validate an `updatePlotImage` call *before* it reaches the wallet so smart
 * wallets / Coinbase Smart Wallet never hit a cryptic "failed to estimate gas
 * for user operation: execution reverted". Confirms the connected account is
 * still the on-chain owner and that the call simulates cleanly. Returns a
 * human-readable error string, or `null` when the transaction is safe to send.
 */
async function preflightImageUpdate(
  publicClient: MinimalPublicClient | null | undefined,
  account: `0x${string}` | undefined,
  plotId: number,
  uri: string,
): Promise<string | null> {
  if (!account) return "Connect your wallet first";
  const v = uri.trim();
  if (!v) return "Add an image before saving";
  if (v.length > MAX_ONCHAIN_IMAGE_BYTES)
    return "Image is too large to store on-chain — try a simpler one";
  // Without a public client we can't preflight; let the wallet handle it.
  if (!publicClient) return null;
  try {
    const plot = (await publicClient.readContract({
      address: baseBoardAddress,
      abi: baseBoardAbi,
      functionName: "getPlot",
      args: [BigInt(plotId)],
    })) as Plot | undefined;
    if (!plot || plot.owner.toLowerCase() !== account.toLowerCase())
      return "You no longer own this plot — refresh your profile and try again";

    await publicClient.simulateContract({
      address: baseBoardAddress,
      abi: baseBoardAbi,
      functionName: "updatePlotImage",
      args: [BigInt(plotId), v],
      account,
    });
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
  const publicClient = usePublicClient();
  const { ids, isLoading } = usePlotsByOwner(address);

  const [details, setDetails] = useState<Record<number, Plot>>({});

  // Multi-select: apply one image across several owned plots in one tx.
  const [multiMode, setMultiMode] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);

  const toggleSelected = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((i) => i !== id) : [...s, id]));

  // Reset multi-select whenever the drawer closes or the wallet changes.
  useEffect(() => {
    if (!profileOpen) {
      setMultiMode(false);
      setSelected([]);
    }
  }, [profileOpen]);

  // Fetch details for owned plots in one batch.
  useEffect(() => {
    if (!IS_CONTRACT_CONFIGURED || !publicClient || ids.length === 0) {
      setDetails({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = (await publicClient.readContract({
          address: baseBoardAddress,
          abi: baseBoardAbi,
          functionName: "getPlotsBatch",
          args: [ids.map((i) => BigInt(i))],
        })) as readonly Plot[];
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
  }, [ids.join(","), refreshNonce]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-slate-900/30 transition-opacity ${
          profileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setProfileOpen(false)}
      />

      {/* Drawer */}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l-4 border-base-blue bg-white shadow-2xl transition-transform duration-300 ${
          profileOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="border-b-2 border-blue-100 px-5 py-4">
          {/* Back navigation — clear way to return to the board map */}
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
                  {shortAddress(address)}
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
                Connect your wallet to view and manage your plots.
              </p>
              <WalletConnect />
            </div>
          ) : !IS_CONTRACT_CONFIGURED ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              Contract not configured. Deploy BaseBoard.sol and set{" "}
              <code>NEXT_PUBLIC_BASEBOARD_CONTRACT_ADDRESS</code> to manage your
              plots.
            </p>
          ) : isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner size={16} /> Loading your plots…
            </div>
          ) : ids.length === 0 ? (
            <div className="mt-10 text-center text-sm text-slate-500">
              You don&apos;t own any plots yet. Close this panel and buy some on
              the board!
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-600">
                  {ids.length} plot{ids.length === 1 ? "" : "s"} owned
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
                    {multiMode ? "Done" : "＋ One image, many plots"}
                  </button>
                )}
              </div>

              {multiMode && (
                <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-base-blue">
                  Tap the plots you want to cover, then upload a single image —
                  it spans the whole selection in one transaction.
                </p>
              )}

              {ids.map((id) => (
                <OwnedPlotRow
                  key={id}
                  plotId={id}
                  plot={details[id]}
                  selectable={multiMode}
                  checked={selected.includes(id)}
                  onToggle={() => toggleSelected(id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Multi-plot image panel pinned to the bottom while selecting. */}
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
  const setFocusPlotId = useBoardStore((s) => s.setFocusPlotId);
  const setProfileOpen = useBoardStore((s) => s.setProfileOpen);
  const pushToast = useBoardStore((s) => s.pushToast);
  const { writeContractAsync, status, isSuccess, error } = useBaseBoardWrite();

  const [action, setAction] = useState<Action>("none");
  const [priceInput, setPriceInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  const busy = status === "pending" || status === "confirming";

  // Toast + close the form once a submitted tx is mined.
  useEffect(() => {
    if (isSuccess && pendingLabel) {
      pushToast("success", `${pendingLabel} confirmed`);
      setPendingLabel(null);
      setAction("none");
    }
  }, [isSuccess, pendingLabel, pushToast]);

  const submit = async (label: string, fn: () => Promise<unknown>) => {
    setLocalError(null);
    setPendingLabel(label);
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

  const onList = () => {
    const v = parsePrice();
    if (v == null) return;
    void submit("Listing", () =>
      writeContractAsync({
        address: baseBoardAddress,
        abi: baseBoardAbi,
        functionName: "listPlot",
        args: [BigInt(plotId), v],
      }),
    );
  };

  const onUpdatePrice = () => {
    const v = parsePrice();
    if (v == null) return;
    void submit("Price update", () =>
      writeContractAsync({
        address: baseBoardAddress,
        abi: baseBoardAbi,
        functionName: "updatePlotPrice",
        args: [BigInt(plotId), v],
      }),
    );
  };

  const onCancel = () =>
    void submit("Cancel listing", () =>
      writeContractAsync({
        address: baseBoardAddress,
        abi: baseBoardAbi,
        functionName: "cancelListing",
        args: [BigInt(plotId)],
      }),
    );

  const onSaveImage = async (uri: string) => {
    const problem = await preflightImageUpdate(
      publicClient as MinimalPublicClient | undefined,
      address,
      plotId,
      uri,
    );
    if (problem) {
      setLocalError(problem);
      pushToast("error", problem);
      return;
    }
    await submit("Image update", () =>
      writeContractAsync({
        address: baseBoardAddress,
        abi: baseBoardAbi,
        functionName: "updatePlotImage",
        args: [BigInt(plotId), uri.trim()],
      }),
    );
  };

  // In multi-select mode the whole row becomes a selection toggle.
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
          // eslint-disable-next-line @next/next/no-img-element
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
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewSrc(plot.imageUri)}
          alt="plot"
          className="mt-2 h-20 w-full rounded-lg border border-blue-100 object-cover"
        />
      )}

      {/* Action buttons */}
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

      {/* Inline price form */}
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

      {/* Inline image form */}
      {action === "image" && (
        <div className="mt-3">
          <ImageUploader
            initialValue={plot?.imageUri ?? ""}
            busy={busy}
            onSave={onSaveImage}
            aspect={1}
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

/** Bottom panel that applies a single image across several selected plots. */
function MultiImagePanel({
  selected,
  onDone,
}: {
  selected: number[];
  onDone: () => void;
}) {
  const pushToast = useBoardStore((s) => s.pushToast);
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync, status, isSuccess } = useBaseBoardWrite();
  const [pending, setPending] = useState(false);

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

  // Anchor = smallest plot id among the selection (top-most, then left-most) —
  // guaranteed to be owned by the user, so updatePlotImage will pass.
  const anchorId = useMemo(() => Math.min(...selected), [selected]);

  useEffect(() => {
    if (isSuccess && pending) {
      pushToast("success", `Image applied across ${selected.length} plots`);
      setPending(false);
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  const onApply = async (uri: string) => {
    const finalUri = withZone(uri, zone);
    const problem = await preflightImageUpdate(
      publicClient as MinimalPublicClient | undefined,
      address,
      anchorId,
      finalUri,
    );
    if (problem) {
      pushToast("error", problem);
      return;
    }
    setPending(true);
    try {
      await writeContractAsync({
        address: baseBoardAddress,
        abi: baseBoardAbi,
        functionName: "updatePlotImage",
        args: [BigInt(anchorId), finalUri],
      });
      pushToast("info", "Image submitted — waiting for confirmation…");
    } catch (e) {
      setPending(false);
      pushToast("error", friendlyTxError(e));
    }
  };

  return (
    <div className="border-t-2 border-blue-100 bg-white p-4 shadow-[0_-8px_20px_rgba(0,82,255,0.06)]">
      <p className="mb-2 text-sm font-bold text-base-blue">
        {selected.length} plot{selected.length === 1 ? "" : "s"} selected ·{" "}
        {zone.x2 - zone.x1 + 1}×{zone.y2 - zone.y1 + 1} area
      </p>
      <ImageUploader
        busy={busy}
        onSave={onApply}
        saveLabel="Apply to selection"
        aspect={(zone.x2 - zone.x1 + 1) / (zone.y2 - zone.y1 + 1)}
      />
    </div>
  );
}

/**
 * Self-contained image picker: device upload (auto-compressed for on-chain
 * storage) or a pasted URL, with live preview, validation and a Save button
 * that only enables once a valid image is ready.
 */
function ImageUploader({
  initialValue = "",
  busy,
  onSave,
  saveLabel = "Save Image",
  aspect,
}: {
  initialValue?: string;
  busy: boolean;
  onSave: (uri: string) => void | Promise<void>;
  saveLabel?: string;
  /**
   * Target width/height of the destination area. When set (e.g. a multi-plot
   * zone) the uploaded image is cover-fit compressed to that exact shape and
   * the preview is rendered at the same ratio, so the user sees ONE image
   * exactly as it will appear across the whole zone.
   */
  aspect?: number;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);

  const isData = value.startsWith("data:");

  const onPickFile = async (file: File | undefined, input: HTMLInputElement) => {
    setError(null);
    setInfo(null);
    input.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file");
      return;
    }
    setCompressing(true);
    setValue("");
    try {
      const res = await compressImageFile(file, { aspect });
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
  const ready = !busy && !compressing && validationError === null;

  const handleSave = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    await onSave(value.trim());
  };

  return (
    <div className="space-y-2.5">
      {/* Device upload (camera / gallery on mobile) */}
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

      {/* Live status */}
      {compressing && (
        <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <Spinner size={13} /> Optimizing image…
        </p>
      )}
      {info && !error && (
        <p className="text-xs font-semibold text-green-600">{info}</p>
      )}

      {/* Preview — shaped to the destination area so multi-plot zones show one
          unified image exactly as it will render on the board. */}
      {value && !error && !compressing && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewSrc(value)}
          alt="preview"
          className="w-full rounded-lg border border-blue-100 object-cover"
          style={
            aspect
              ? { aspectRatio: String(aspect), maxHeight: "14rem" }
              : { height: "7rem" }
          }
          onError={() => setError("That image could not be loaded")}
        />
      )}

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
