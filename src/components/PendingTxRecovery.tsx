"use client";

import { useEffect, useState } from "react";
import { useWaitForTransactionReceipt } from "wagmi";
import { clearPendingTx, readPendingTx, type PendingTx } from "@/lib/pendingTx";
import { useBoardStore } from "@/store/useBoardStore";

/**
 * On a fresh page load (e.g. the BaseApp webview reloaded mid-transaction),
 * recover any pending tx hash stashed in sessionStorage and resume watching its
 * receipt so the user still gets a confirmation / failure toast instead of
 * silently losing the pending state. Renders nothing.
 */
export function PendingTxRecovery() {
  const pushToast = useBoardStore((s) => s.pushToast);
  const bumpRefresh = useBoardStore((s) => s.bumpRefresh);
  const [pending, setPending] = useState<PendingTx | null>(null);

  // Read once on mount.
  useEffect(() => {
    const rec = readPendingTx();
    if (rec) {
      setPending(rec);
      pushToast("info", `Reconnected — checking your ${rec.label.toLowerCase()}…`);
    }
  }, [pushToast]);

  const { isSuccess, isError } = useWaitForTransactionReceipt({
    hash: pending?.hash,
    query: { enabled: !!pending },
  });

  useEffect(() => {
    if (!pending) return;
    if (isSuccess) {
      pushToast("success", `${pending.label} confirmed`);
      bumpRefresh();
      clearPendingTx();
      setPending(null);
    } else if (isError) {
      pushToast("error", `${pending.label} could not be confirmed`);
      clearPendingTx();
      setPending(null);
    }
  }, [isSuccess, isError, pending, pushToast, bumpRefresh]);

  return null;
}
