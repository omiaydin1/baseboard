"use client";

import { useState } from "react";
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
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  type Connector,
} from "wagmi";
import { CELO_CHAIN_ID, DEV_LOCAL } from "@/lib/constants";
import { shortAddress } from "@/lib/coords";
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

  // Connected: keep the legacy OnchainKit account dropdown on Base; on Celo use
  // a plain address + disconnect control (OnchainKit identity is Base-only).
  if (isConnected) {
    if (isCelo) return <CeloConnected />;
    return (
      <Wallet>
        <ConnectWallet className="!bg-base-blue !text-white !rounded-xl !px-4 !py-2 !font-semibold hover:!bg-base-dark">
          <Avatar className="h-5 w-5" />
          <Name />
        </ConnectWallet>
        <WalletDropdown>
          <Identity className="px-4 pt-3 pb-2" hasCopyAddressOnClick>
            <Avatar />
            <Name />
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

  // De-dupe by id and, on Celo, drop Coinbase (unsupported).
  const seen = new Set<string>();
  const list = connectors.filter((c) => {
    if (hideCoinbase && isCoinbaseConnector(c.id, c.name)) return false;
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
              <span>{connectorLabel(c)}</span>
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

/** Connected state on Celo: address + disconnect. */
function CeloConnected() {
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
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
