// Dev-only: buy a block of plots for account #0 so the profile/image flow can
// be tested. Usage: hardhat run scripts/seed-local.cjs --network localhost
const hre = require("hardhat");

const ADDRESS = process.env.LOCAL_CONTRACT_ADDRESS;
const GRID = 3162;
const PRICE = hre.ethers.parseEther("0.00005");

// Buy an 8x8 block with its top-left at (X0, Y0).
const X0 = 100;
const Y0 = 100;
const W = 8;
const H = 8;

async function main() {
  if (!ADDRESS) throw new Error("Set LOCAL_CONTRACT_ADDRESS env var");
  const [signer] = await hre.ethers.getSigners();
  const board = await hre.ethers.getContractAt("BaseBoard", ADDRESS, signer);

  const ids = [];
  for (let y = Y0; y < Y0 + H; y++) {
    for (let x = X0; x < X0 + W; x++) ids.push(y * GRID + x);
  }

  const tx = await board.buyPlots(ids, { value: PRICE * BigInt(ids.length) });
  await tx.wait();
  console.log(`Bought ${ids.length} plots (${W}x${H}) at (${X0},${Y0}).`);
  console.log(`Top-left plotId = ${Y0 * GRID + X0}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
