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
} from "wagmi";
import { CELO_CHAIN_ID, DEV_LOCAL } from "@/lib/constants";
import { shortAddress } from "@/lib/coords";

/** Whether a connector is Coinbase Wallet / Smart Wallet. */
function isCoinbaseConnector(id: string, name: string): boolean {
  return /coinbase/i.test(id) || /coinbase/i.test(name);
}

/**
 * Connect / account button. On Base it uses OnchainKit's Coinbase-first flow.
 * On Celo — which Coinbase Smart Wallet does not support — it falls back to a
 * connector list that hides Coinbase and steers users to MetaMask / Rabby /
 * WalletConnect instead.
 */
export function WalletConnect() {
  // Dev-only: connect straight to the injected local provider so the full flow
  // can be tested against a Hardhat node without a real wallet popup.
  if (DEV_LOCAL) return <DevWalletConnect />;

  return <ChainAwareWalletConnect />;
}

function ChainAwareWalletConnect() {
  const chainId = useChainId();
  const isCelo = chainId === CELO_CHAIN_ID;

  if (isCelo) return <CeloWalletConnect />;

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

/**
 * Celo connect UI: Coinbase Smart Wallet is hidden because it cannot transact
 * on Celo Mainnet. Offers MetaMask / Rabby (injected) and WalletConnect.
 */
function CeloWalletConnect() {
  const { isConnected, address } = useAccount();
  const { connect, connectors, isPending } = useConnect();
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

  const usable = connectors.filter(
    (c) => !isCoinbaseConnector(c.id, c.name),
  );
  // De-dupe by id (some setups register multiple injected entries).
  const seen = new Set<string>();
  const list = usable.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  const label = (id: string, name: string): string => {
    if (id === "injected") return "MetaMask / Rabby / Browser Wallet";
    if (/walletconnect/i.test(id)) return "WalletConnect";
    return name;
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {list.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => connect({ connector: c })}
            disabled={isPending}
            className="rounded-xl bg-base-blue px-4 py-2 text-sm font-semibold text-white hover:bg-base-dark disabled:opacity-60"
          >
            {label(c.id, c.name)}
          </button>
        ))}
      </div>
      <p className="max-w-[15rem] text-right text-[11px] leading-tight text-slate-500">
        Coinbase Smart Wallet isn&apos;t supported on Celo — connect with
        MetaMask, Rabby or WalletConnect.
      </p>
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
