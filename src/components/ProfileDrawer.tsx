"use client";

import { useEffect, useState } from "react";
import { formatEther, parseEther } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { Spinner } from "./Spinner";
import { WalletConnect } from "./WalletConnect";
import { useBoardStore } from "@/store/useBoardStore";
import { usePlotsByOwner, useBaseBoardWrite } from "@/hooks/useBaseBoard";
import { baseBoardAbi, baseBoardAddress } from "@/lib/contract";
import { IS_CONTRACT_CONFIGURED } from "@/lib/constants";
import { shortAddress, xyFromPlotId } from "@/lib/coords";
import type { Plot } from "@/lib/types";

export function ProfileDrawer() {
  const profileOpen = useBoardStore((s) => s.profileOpen);
  const setProfileOpen = useBoardStore((s) => s.setProfileOpen);
  const refreshNonce = useBoardStore((s) => s.refreshNonce);
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { ids, isLoading } = usePlotsByOwner(address);

  const [details, setDetails] = useState<Record<number, Plot>>({});

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
        <header className="flex items-center justify-between border-b-2 border-blue-100 px-5 py-4">
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
              <p className="text-sm font-semibold text-slate-600">
                {ids.length} plot{ids.length === 1 ? "" : "s"} owned
              </p>
              {ids.map((id) => (
                <OwnedPlotRow key={id} plotId={id} plot={details[id]} />
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

type Action = "none" | "list" | "price" | "image";

function OwnedPlotRow({ plotId, plot }: { plotId: number; plot?: Plot }) {
  const { x, y } = xyFromPlotId(plotId);
  const setFocusPlotId = useBoardStore((s) => s.setFocusPlotId);
  const setProfileOpen = useBoardStore((s) => s.setProfileOpen);
  const { writeContractAsync, status, error } = useBaseBoardWrite();

  const [action, setAction] = useState<Action>("none");
  const [priceInput, setPriceInput] = useState("");
  const [imageInput, setImageInput] = useState(plot?.imageUri ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const busy = status === "pending" || status === "confirming";

  const run = async (fn: () => Promise<unknown>) => {
    setLocalError(null);
    try {
      await fn();
      setAction("none");
    } catch (e) {
      setLocalError(e instanceof Error ? e.message.slice(0, 140) : "Failed");
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
    return run(() =>
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
    return run(() =>
      writeContractAsync({
        address: baseBoardAddress,
        abi: baseBoardAbi,
        functionName: "updatePlotPrice",
        args: [BigInt(plotId), v],
      }),
    );
  };

  const onCancel = () =>
    run(() =>
      writeContractAsync({
        address: baseBoardAddress,
        abi: baseBoardAbi,
        functionName: "cancelListing",
        args: [BigInt(plotId)],
      }),
    );

  const onImage = () =>
    run(() =>
      writeContractAsync({
        address: baseBoardAddress,
        abi: baseBoardAbi,
        functionName: "updatePlotImage",
        args: [BigInt(plotId), imageInput],
      }),
    );

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
          src={plot.imageUri}
          alt="plot"
          className="mt-2 h-20 w-full rounded-lg border border-blue-100 object-cover"
        />
      )}

      {/* Action buttons */}
      <div className="mt-3 flex flex-wrap gap-2">
        {!plot?.isForSale ? (
          <ActionButton onClick={() => setAction(action === "list" ? "none" : "list")}>
            List for Sale
          </ActionButton>
        ) : (
          <>
            <ActionButton
              onClick={() => setAction(action === "price" ? "none" : "price")}
            >
              Update Price
            </ActionButton>
            <ActionButton onClick={onCancel} variant="danger">
              Cancel Listing
            </ActionButton>
          </>
        )}
        <ActionButton onClick={() => setAction(action === "image" ? "none" : "image")}>
          Upload/Update Image
        </ActionButton>
      </div>

      {/* Inline forms */}
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
          <button
            type="button"
            onClick={action === "list" ? onList : onUpdatePrice}
            disabled={busy}
            className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-base-blue px-3 py-1.5 text-sm font-bold text-white hover:bg-base-dark disabled:opacity-50"
          >
            {busy && <Spinner size={14} className="!border-white/40 !border-t-white" />}
            {action === "list" ? "List" : "Update"}
          </button>
        </div>
      )}

      {action === "image" && (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={imageInput}
            onChange={(e) => setImageInput(e.target.value)}
            placeholder="https://… or ipfs://CID"
            className="w-full rounded-lg border-2 border-blue-100 px-3 py-1.5 text-sm focus:border-base-blue focus:outline-none"
          />
          <button
            type="button"
            onClick={onImage}
            disabled={busy}
            className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-base-blue px-3 py-1.5 text-sm font-bold text-white hover:bg-base-dark disabled:opacity-50"
          >
            {busy && <Spinner size={14} className="!border-white/40 !border-t-white" />}
            Save
          </button>
        </div>
      )}

      {status === "success" && (
        <p className="mt-2 text-xs font-semibold text-green-600">Updated!</p>
      )}
      {(localError || error) && status !== "success" && (
        <p className="mt-2 break-words text-xs text-red-600">
          {localError || error?.message?.slice(0, 140)}
        </p>
      )}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border-2 px-2.5 py-1 text-xs font-semibold ${
        variant === "danger"
          ? "border-red-200 text-red-600 hover:bg-red-50"
          : "border-base-blue text-base-blue hover:bg-blue-50"
      }`}
    >
      {children}
    </button>
  );
}
