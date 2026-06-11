// Dev-only: deploy BaseBoard to a running local Hardhat node and print the
// address. Does NOT write .env.local (so the mainnet address is preserved).
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const BaseBoard = await hre.ethers.getContractFactory("BaseBoard");
  const board = await BaseBoard.deploy();
  await board.waitForDeployment();

  const address = await board.getAddress();
  console.log("LOCAL_CONTRACT_ADDRESS=" + address);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
