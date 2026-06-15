"use client";

import { useEffect, useRef, useState } from "react";
import {
  ConnectWallet,
  Wallet,
  WalletDropdown,
  WalletDropdownDisconnect,
} from "@coinbase/onchainkit/wallet";
import {
  Address,
  Avatar,
  EthBalance,
  Identity,
  Name,
} from "@coinbase/onchainkit/identity";
import { base } from "wagmi/chains";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  type Connector,
} from "wagmi";
import { CELO_CHAIN_ID, DEV_LOCAL } from "@/lib/constants";
import { shortAddress } from "@/lib/coords";
import { useCeloName } from "@/hooks/useCeloName";
import { Modal } from "./Modal";

/** Whether a connector is Coinbase Wallet / Smart Wallet. */
function isCoinbaseConnector(id: string, name: string): boolean {
  return /coinbase/i.test(id) || /coinbase/i.test(name);
}

/** Friendly, stable label for a connector. */
function connectorLabel(c: Connector): string {
  if (isCoinbaseConnector(c.id, c.name)) return "Coinbase Smart Wallet";
  if (c.id === "injected") return "MetaMask / Rabby / Browser Wallet";
  if (/walletconnect/i.test(c.id)) return "WalletConnect";
  return c.name;
}

/**
 * Wallet icon for the modal list. Prefers the connector's own icon (EIP-6963
 * wallets like MetaMask / OKX / Rainbow expose a data-URI `icon`); otherwise
 * falls back to a neutral monogram tile so every row is visually aligned.
 */
function ConnectorIcon({ connector }: { connector: Connector }) {
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
 * Connect / account button. Disconnected, it always shows a single clean
 * "Connect Wallet" button that opens a wallet-selection modal. Coinbase Smart
 * Wallet is offered everywhere *except* Celo (which it cannot transact on),
 * where users are steered to MetaMask / Rabby / WalletConnect.
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
  const isCelo = chainId === CELO_CHAIN_ID;

  // Connected: keep the OnchainKit account dropdown on Base (resolves basenames,
  // click toggles a dropdown with Disconnect). On Celo use a matching custom
  // account button + dropdown (OnchainKit identity is Base-only).
  if (isConnected) {
    if (isCelo) return <CeloConnected />;
    return (
      <Wallet>
        <ConnectWallet className="!bg-base-blue !text-white !rounded-xl !px-4 !py-2 !font-semibold hover:!bg-base-dark">
          <Avatar chain={base} className="h-5 w-5" />
          <Name chain={base} />
        </ConnectWallet>
        <WalletDropdown>
          <Identity className="px-4 pt-3 pb-2" chain={base} hasCopyAddressOnClick>
            <Avatar chain={base} />
            <Name chain={base} />
            <Address />
            <EthBalance />
          </Identity>
          <WalletDropdownDisconnect />
        </WalletDropdown>
      </Wallet>
    );
  }

  return <ConnectWalletButton hideCoinbase={isCelo} />;
}

/** Single "Connect Wallet" button + a modal listing the available wallets. */
function ConnectWalletButton({ hideCoinbase }: { hideCoinbase: boolean }) {
  const [open, setOpen] = useState(false);
  const { connect, connectors, isPending } = useConnect();

  // De-dupe by id and drop the generic/duplicate rows: the explicit per-wallet
  // (EIP-6963) rows below already cover MetaMask / Rabby / OKX / Rainbow, and
  // the generic "Coinbase Smart Wallet" row is redundant here.
  const seen = new Set<string>();
  const list = connectors.filter((c) => {
    if (c.id === "injected") return false;
    if (isCoinbaseConnector(c.id, c.name)) return false;
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

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
          {hideCoinbase && (
            <p className="mt-1 text-[11px] leading-tight text-slate-500">
              Coinbase Smart Wallet isn&apos;t supported on Celo — connect with
              MetaMask, Rabby or WalletConnect.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

/** Connected state on Celo: identity-resolving account button + dropdown. */
function CeloConnected() {
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const celoName = useCeloName(address);
  return (
    <ConnectedAccount
      address={address}
      name={celoName}
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
