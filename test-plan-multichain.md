# Test Plan — Multi-chain (Base + Celo) — PR #2

Target: local dev server (`npm run dev`, DEV_LOCAL off, multi-chain config). Mock EIP-1193 wallet injected via Playwright/CDP (account + chainId switching). Temp test-only edits: wagmi `chains:[celo,base]` (app starts on Celo so the injected connect button is reachable) + a `console.log` in the canvas chainId-isolation effect for non-visual proof. Both reverted after testing.

Grounding (code): NetworkSwitcher `src/components/NetworkSwitcher.tsx:47-57` (`select`→`switchChain`); wallet guard `src/components/WalletConnect.tsx:44-128` (Celo branch hides coinbase connectors, shows hint); chain-aware subtitle `HangingHeader`/`page.tsx` footer use `cfg.name`/`cfg.chainId`; state isolation `BaseBoardCanvas.tsx:685-696`.

## Test 1 — Coinbase Smart Wallet hidden on Celo (wallet guard)
State: app on Celo (42220), disconnected.
- PASS: wallet area shows a **"MetaMask / Rabby / Browser Wallet"** button and the hint text **"Coinbase Smart Wallet isn't supported on Celo — connect with MetaMask, Rabby or WalletConnect."**, and there is **NO** "Connect Wallet"/Coinbase blue button.
- FAIL (broken impl): a Coinbase "Connect Wallet" button appears on Celo, or the hint is absent.

## Test 2 — NetworkSwitcher dropdown + brand logos
Action: click the network button (top-right, shows "Celo" + circle logo) to open the dropdown.
- PASS: dropdown lists exactly two rows — **Base** with a **square** blue mark and **Celo** with a **circular** yellow mark; Celo row is marked active (blue dot / highlight).
- FAIL: missing a chain, wrong/duplicated logo shapes (e.g. Base shown as a circle), or dropdown doesn't open.

## Test 3 — Switch Celo → Base via dropdown (wallet_switchEthereumChain + chain-aware config + state isolation)
Pre: connect via the "MetaMask / Rabby / Browser Wallet" button (mock injected) so a connector exists; confirm it connects on Celo (button becomes `0x1111… · Disconnect`).
Action: open the dropdown, click **Base**.
- PASS, all of:
  - header subtitle changes from **"CELO MAINNET"** → **"BASE MAINNET"**;
  - footer changes from **"Celo Mainnet (42220)"** → **"Base Mainnet (8453)"**;
  - the switcher button logo changes from the Celo circle to the Base square (label "Base");
  - devtools console logs **`[chain-switch] isolating board state, new chainId = 8453`** (proves the cache-clear isolation effect ran);
  - the Base wallet UI (OnchainKit) is now what renders for Base (no Celo no-Coinbase hint).
- FAIL: subtitle/footer stay on Celo, no console isolation log, or the switch silently no-ops.

## Test 4 (regression) — Base default disconnected shows Coinbase path
After reverting the temp `chains:[celo,base]` edit, load app default (Base 8453), disconnected.
- PASS: subtitle "BASE MAINNET", footer "Base Mainnet (8453)", and the wallet area shows the OnchainKit **Coinbase "Connect Wallet"** blue button (NOT the Celo no-Coinbase variant). Confirms Base path untouched.
- FAIL: Base shows the Celo no-Coinbase UI, or wrong chain label.
