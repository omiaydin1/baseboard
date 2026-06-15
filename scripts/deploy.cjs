const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const signers = await hre.ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      "No deployer account configured. Set PRIVATE_KEY in .env (no 0x prefix needed) and retry.",
    );
  }
  const deployer = signers[0];
  console.log("Deploying BaseBoard with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  if (balance === 0n) {
    throw new Error(
      "Deployer account has zero balance. Fund it with Base ETH for gas.",
    );
  }

  const BaseBoard = await hre.ethers.getContractFactory("BaseBoard");
  console.log("Deploying...");
  // Base Mainnet: 0.00005 ETH per plot, original treasury.
  const plotPrice = hre.ethers.parseEther("0.00005");
  const treasury = "0xce835359202acbB4a10d9a2f97a72E6d0B76f1e2";
  const board = await BaseBoard.deploy(plotPrice, treasury);
  await board.waitForDeployment();

  const address = await board.getAddress();
  const network = await hre.ethers.provider.getNetwork();
  console.log("BaseBoard deployed to:", address);
  console.log("Chain ID:", network.chainId.toString());

  // Write the deployed address to .env.local so the Next.js app picks it up.
  const envLocalPath = path.resolve(__dirname, "..", ".env.local");
  const envKey = "NEXT_PUBLIC_BASEBOARD_CONTRACT_ADDRESS";
  const line = `${envKey}=${address}`;

  let existing = "";
  try {
    existing = fs.readFileSync(envLocalPath, "utf-8");
  } catch {
    /* file may not exist yet */
  }

  if (new RegExp(`^${envKey}=`, "m").test(existing)) {
    const updated = existing.replace(new RegExp(`^${envKey}=.*$`, "m"), line);
    fs.writeFileSync(envLocalPath, updated, "utf-8");
  } else {
    const nl = existing.endsWith("\n") || existing === "" ? "" : "\n";
    fs.writeFileSync(envLocalPath, existing + nl + line + "\n", "utf-8");
  }

  console.log(`\nWritten ${envKey}=${address} to .env.local`);
  console.log(
    "Restart the Next.js dev server (`npm run dev`) for the yellow warning to disappear and live stats to load.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
