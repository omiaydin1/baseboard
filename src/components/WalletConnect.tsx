"use client";

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
  useSwitchChain,
} from "wagmi";
import { ACTIVE_CHAIN_ID, DEV_LOCAL } from "@/lib/constants";
import { shortAddress } from "@/lib/coords";

/**
 * Connect / account button powered by OnchainKit. Supports Coinbase Wallet,
 * MetaMask / injected wallets, and (when configured) WalletConnect. When the
 * wallet is connected to the wrong chain, a prominent "Switch to Base" button
 * is shown instead so the app only ever transacts on Base Mainnet (8453).
 */
export function WalletConnect() {
  // Dev-only: connect straight to the injected local provider so the full flow
  // can be tested against a Hardhat node without a real wallet popup.
  if (DEV_LOCAL) return <DevWalletConnect />;

  return (
    <div className="flex items-center gap-2">
      <NetworkSwitchButton />
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
    </div>
  );
}

/**
 * Prominent "Wrong Network" pill + one-tap switch to Base Mainnet. Renders
 * nothing when disconnected or already on the correct chain.
 */
function NetworkSwitchButton() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected || chainId === ACTIVE_CHAIN_ID) return null;

  return (
    <button
      type="button"
      onClick={() => switchChain({ chainId: ACTIVE_CHAIN_ID })}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-sm font-bold text-white shadow hover:bg-amber-600 disabled:opacity-60"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
      {isPending ? "Switching…" : "Switch to Base"}
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
