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

/**
 * Connect / account button powered by OnchainKit. Supports Coinbase Wallet,
 * MetaMask / injected wallets, and (when configured) WalletConnect.
 */
export function WalletConnect() {
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
