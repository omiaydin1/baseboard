/**
 * Measures gas cost of BaseBoard.buyPlots for varying plot counts.
 *
 * Deploys a fresh contract per test case.
 *
 * Usage: npx hardhat run scripts/gas-estimate.cjs
 */
const { ethers } = require("hardhat");
const PLOT_PRICE = ethers.parseEther("0.00005");

async function main() {
  const [deployer, buyer] = await ethers.getSigners();

  const sizes = [1, 10, 50, 100, 150, 200, 245, 246, 247];

  for (const n of sizes) {
    // Deploy a fresh contract so every id is unowned
    const treasury = ethers.Wallet.createRandom().address;
    const BaseBoard = await ethers.getContractFactory("BaseBoard");
    const board = await BaseBoard.deploy(PLOT_PRICE, treasury);
    await board.waitForDeployment();

    // Use the very first N plot ids (0 .. n-1) in the fresh contract
    const ids = Array.from({ length: n }, (_, i) => BigInt(i));

    const tx = await board
      .connect(buyer)
      .buyPlots(ids, { value: PLOT_PRICE * BigInt(n) });

    const receipt = await tx.wait();
    const used = receipt.gasUsed;
    const gasPerPlot = Number(used) / n;

    // Approximate calldata size: 4 (selector) + 32 (offset) + 32 (length) + n*32 (elements)
    const calldataEstimate = 4 + 32 + 32 + n * 32;

    console.log(
      `n=${n.toString().padStart(6)} | gasUsed=${used.toString().padStart(10)} | gas/plot=${gasPerPlot.toFixed(0).padStart(7)} | estCalldata=${calldataEstimate}B`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
