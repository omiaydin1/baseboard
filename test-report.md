# Test Report — Multi-chain (Base + Celo) — PR #2

**Result: all 4 tests PASSED.** Tested against the local production-config dev server (multi-chain, `DEV_LOCAL` off). A mock EIP-1193 wallet was injected via Playwright/CDP to drive the `injected` connector and `wallet_switchEthereumChain`. Two temporary test-only edits (wagmi `chains:[celo,base]` to start on Celo for an automatable connect button, and a `console.log` in the canvas isolation effect) were applied during testing and **reverted afterward** — the PR branch is unchanged.

## Tests

- **T1 — Coinbase Smart Wallet hidden on Celo:** PASS. On Celo the wallet area shows only "MetaMask / Rabby / Browser Wallet" + the hint, no Coinbase button.
- **T2 — Switcher brand logos:** PASS. Dropdown lists Base (blue square mark) and Celo (yellow circle mark); Celo marked active.
- **T3 — Switch Celo→Base + state isolation:** PASS. Selecting Base flips subtitle/footer to "Base Mainnet (8453)", logs `[chain-switch] isolating board state, new chainId = 8453`, and loads Base reads (Total Plots Sold 32, vs 0 on Celo).
- **T4 (regression) — Base path untouched:** PASS. On Base, disconnected shows the OnchainKit Coinbase "Connect Wallet" button.

## Evidence

### T1 — Celo hides Coinbase
![Celo disconnected: MetaMask/Rabby only + hint, no Coinbase](/home/ubuntu/screenshots/screenshot_zoom_c25af701f84841c6845ecfe13d695157.png)

### T2 — Dropdown logos (Base square / Celo circle)
![Switcher dropdown with Base square + Celo circle](/home/ubuntu/screenshots/screenshot_zoom_eafe2f0abfba43aebf8348c16cdae7a2.png)

### T3 — After switching to Base (subtitle/footer + reads + console)
![Switched to Base: Base Mainnet 8453, 32 plots sold, isolation console log](/home/ubuntu/screenshots/screenshot_696247328f6d42298a10b3090868989a.png)

Console isolation log (proves caches cleared on chainId change):
![console: chain-switch isolating board state, new chainId = 8453](/home/ubuntu/screenshots/screenshot_zoom_7fb21c3f12054ad5a674facc4af433e5.png)

### T4 — Base disconnected shows Coinbase Connect Wallet
![Base disconnected: OnchainKit Coinbase Connect Wallet](/home/ubuntu/screenshots/screenshot_197ee5e1f325473c8e808ca3ca1f31d6.png)

## Notes
- Celo contract is still the placeholder `0x71aad…812b` (none deployed) → Celo board reads empty, as expected; Base reads work (32 sold).
- WalletConnect button is absent in the Celo list because no `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is configured locally (expected); the injected option + hint are present.
