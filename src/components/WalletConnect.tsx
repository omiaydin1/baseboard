"use client";

import { useEffect, useRef, useState } from "react";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
  type Connector,
} from "wagmi";
import { BASE_CHAIN_ID, DEV_LOCAL } from "@/lib/constants";
import { BASE_WALLET_ID, COINBASE_WALLET_ID } from "@/lib/wagmi";
import { shortAddress } from "@/lib/coords";
import { useBaseName } from "@/hooks/useBaseName";
import { BaseLogo } from "./ChainLogos";
import { Spinner } from "./Spinner";
import { Modal } from "./Modal";

/** Whether a connector belongs to the Coinbase family (Coinbase / Base Wallet). */
function isCoinbaseFamily(c: Connector): boolean {
  return (
    c.id === COINBASE_WALLET_ID ||
    c.id === BASE_WALLET_ID ||
    /coinbase/i.test(c.id) ||
    /coinbase/i.test(c.name)
  );
}

/** Friendly, stable label for a connector. */
function connectorLabel(c: Connector): string {
  if (c.id === BASE_WALLET_ID) return "Base Wallet";
  if (isCoinbaseFamily(c)) return "Coinbase Wallet";
  if (c.id === "injected") return "Browser Wallet";
  if (/walletconnect/i.test(c.id)) return "WalletConnect";
  return c.name;
}

/** Coinbase brand mark for the Coinbase Wallet row. */
function CoinbaseMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0052FF" />
      <circle cx="16" cy="16" r="9" fill="#FFFFFF" />
      <rect x="12.5" y="12.5" width="7" height="7" rx="1.4" fill="#0052FF" />
    </svg>
  );
}

/**
 * Wallet icon for the modal list. Prefers the connector's own icon (EIP-6963
 * wallets like MetaMask / OKX / Rainbow expose a data-URI `icon`); otherwise
 * falls back to a neutral monogram tile so every row is visually aligned.
 */
function ConnectorIcon({ connector }: { connector: Connector }) {
  if (connector.id === BASE_WALLET_ID) {
    return <BaseLogo size={28} className="shrink-0 rounded-lg" />;
  }
  if (isCoinbaseFamily(connector)) {
    return (
      <span className="shrink-0">
        <CoinbaseMark size={28} />
      </span>
    );
  }
  const icon = connector.icon;
  if (icon) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icon}
        alt=""
        aria-hidden
        className="h-7 w-7 shrink-0 rounded-lg object-contain"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-base-blue/10 text-xs font-black text-base-blue"
    >
      {connectorLabel(connector).charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * Connect / account button. Disconnected, it shows a single clean
 * "Connect Wallet" button that opens a wallet-selection modal.
 */
export function WalletConnect() {
  // Dev-only: connect straight to the injected local provider so the full flow
  // can be tested against a Hardhat node without a real wallet popup.
  if (DEV_LOCAL) return <DevWalletConnect />;

  return <ChainAwareWalletConnect />;
}

function ChainAwareWalletConnect() {
  const chainId = useChainId();
  const { isConnected } = useAccount();

  // Connected: keep the OnchainKit account dropdown on Base (resolves basenames,
  // click toggles a dropdown with Disconnect). On any other (unsupported)
  // network, enforce a one-tap switch to Base.
  if (isConnected) {
    if (chainId !== BASE_CHAIN_ID) return <SwitchToBaseButton />;
    return <BaseConnected />;
  }

  return <ConnectWalletButton />;
}

/** Single "Connect Wallet" button + a modal listing the available wallets. */
function ConnectWalletButton() {
  const [open, setOpen] = useState(false);
  const { connect, connectors, isPending } = useConnect();

  // Build the wallet list so something is ALWAYS visible — including inside
  // mobile / BaseApp webviews where no EIP-6963 wallets are announced.
  //  1. Explicit per-wallet rows detected via EIP-6963 (MetaMask/Rabby/OKX/…).
  //  2. Coinbase Wallet + Base Wallet (native onboarding).
  //  3. WalletConnect (mobile deep-link / QR).
  //  4. A generic "Browser Wallet" fallback only when no EIP-6963 wallet was
  //     detected, so in-app webviews with a bare window.ethereum still connect.
  const detected = connectors.filter(
    (c) => c.type === "injected" && c.id !== "injected" && !isCoinbaseFamily(c),
  );
  const coinbase = connectors.find((c) => c.id === COINBASE_WALLET_ID);
  const baseWallet = connectors.find((c) => c.id === BASE_WALLET_ID);
  const walletConnectC = connectors.find((c) => /walletconnect/i.test(c.id));
  const genericInjected = connectors.find((c) => c.id === "injected");

  // Fixed top-to-bottom hierarchy:
  //   1. Base Wallet  2. Coinbase Wallet  3. MetaMask
  //   4. other branded EIP-6963 wallets (Rabby/OKX/Rainbow/…)  5. WalletConnect
  const metamask = detected.find(
    (c) => /metamask/i.test(c.name) || /metamask/i.test(c.id),
  );
  const otherDetected = detected.filter((c) => c.id !== metamask?.id);

  const list: Connector[] = [];
  const add = (c?: Connector) => {
    if (c && !list.some((x) => x.id === c.id)) list.push(c);
  };
  add(baseWallet);
  add(coinbase);
  add(metamask);
  otherDetected.forEach(add);
  add(walletConnectC);
  if (detected.length === 0) add(genericInjected);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl bg-base-blue px-4 py-2 font-semibold text-white hover:bg-base-dark"
      >
        Connect Wallet
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Connect a wallet">
        <div className="flex flex-col gap-2">
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={isPending}
              onClick={() => {
                connect({ connector: c });
                setOpen(false);
              }}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left font-semibold text-slate-800 transition hover:border-base-blue hover:bg-base-blue/5 disabled:opacity-60"
            >
              <span className="flex min-w-0 items-center gap-3">
                <ConnectorIcon connector={c} />
                <span className="truncate">{connectorLabel(c)}</span>
              </span>
              <span aria-hidden className="text-base-blue">
                →
              </span>
            </button>
          ))}
          {list.length === 0 && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
              No wallet detected. Open this site inside your wallet app&apos;s
              browser, or install MetaMask / Rabby / Coinbase Wallet to connect.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

/**
 * Wrong-network enforcement: when a connected wallet is on a network other than
 * Base, the button reads "SWITCH TO BASE" and a tap fires
 * `wallet_switchEthereumChain` for Base Mainnet (8453).
 */
function SwitchToBaseButton() {
  const { switchChain, isPending } = useSwitchChain();
  return (
    <button
      type="button"
      onClick={() =>
        switchChain({
          chainId: BASE_CHAIN_ID as Parameters<
            typeof switchChain
          >[0]["chainId"],
        })
      }
      disabled={isPending}
      className="inline-flex items-center gap-2 rounded-xl bg-base-blue px-4 py-2 font-semibold text-white hover:bg-base-dark disabled:opacity-60"
    >
      {isPending && (
        <Spinner size={16} className="!border-white/40 !border-t-white" />
      )}
      SWITCH TO BASE
    </button>
  );
}

/** Connected state on Base: Basename-resolving account button + dropdown. */
function BaseConnected() {
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const baseName = useBaseName(address);
  return (
    <ConnectedAccount
      address={address}
      name={baseName}
      onDisconnect={() => disconnect()}
    />
  );
}

/** Deterministic gradient "user icon" derived from the address. */
function avatarGradient(addr?: string): string {
  const a = (addr ?? "0x000000").toLowerCase();
  const h1 = parseInt(a.slice(2, 8) || "0", 16) % 360;
  const h2 = (h1 + 80) % 360;
  return `linear-gradient(135deg, hsl(${h1} 70% 55%), hsl(${h2} 72% 45%))`;
}

/**
 * Connected account control matching the Base layout: a blue button showing a
 * clean avatar + resolved name (or short address). Clicking it toggles a
 * dropdown holding the full address and the Disconnect action — no inline
 * "· Disconnect" text on the button face.
 */
function ConnectedAccount({
  address,
  name,
  onDisconnect,
}: {
  address?: `0x${string}`;
  name?: string | null;
  onDisconnect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const label = name || shortAddress(address);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-xl bg-base-blue px-3 py-2 font-semibold text-white hover:bg-base-dark"
      >
        <span
          aria-hidden
          className="h-5 w-5 shrink-0 rounded-full ring-2 ring-white/40"
          style={{ background: avatarGradient(address) }}
        />
        <span className="max-w-[140px] truncate">{label}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <span
              aria-hidden
              className="h-8 w-8 shrink-0 rounded-full"
              style={{ background: avatarGradient(address) }}
            />
            <div className="min-w-0">
              {name && (
                <p className="truncate text-sm font-semibold text-slate-800">
                  {name}
                </p>
              )}
              <p className="truncate font-mono text-xs text-slate-500">
                {shortAddress(address)}
              </p>
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDisconnect();
            }}
            className="block w-full px-4 py-3 text-left text-sm font-semibold text-red-600 hover:bg-red-50"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function DevWalletConnect() {
  const { isConnected, address } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) {
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        className="rounded-xl bg-base-blue px-4 py-2 font-semibold text-white hover:bg-base-dark"
      >
        {shortAddress(address)} · Disconnect
      </button>
    );
  }

  const injected = connectors.find((c) => c.id === "injected") ?? connectors[0];

  return (
    <button
      type="button"
      onClick={() => injected && connect({ connector: injected })}
      className="rounded-xl bg-base-blue px-4 py-2 font-semibold text-white hover:bg-base-dark"
    >
      Connect (local)
    </button>
  );
}
