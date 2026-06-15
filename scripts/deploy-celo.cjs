// Deploy BaseBoard to Celo Mainnet (42220).
//   - PLOT_PRICE = 1.3 CELO per plot
//   - TREASURY   = 0x71aad1110dfd8f60249cd45ce4fb05163b6f812b
// Requires CELO_DEPLOYER_PRIVATE_KEY (a funded Celo account) in the env.
// Run: npx hardhat run scripts/deploy-celo.cjs --network celo
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const CELO_PRICE = "1.3"; // CELO per plot
const CELO_TREASURY = "0x71aad1110dfd8f60249cd45ce4fb05163b6f812b";

async function main() {
  const net = await hre.ethers.provider.getNetwork();
  if (net.chainId !== 42220n) {
    throw new Error(
      `Wrong network (chainId ${net.chainId}). Run with --network celo.`,
    );
  }

  const signers = await hre.ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      "No deployer configured. Set CELO_DEPLOYER_PRIVATE_KEY in the env and retry.",
    );
  }
  const deployer = signers[0];
  console.log("Deploying BaseBoard to Celo with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "CELO");
  if (balance === 0n) {
    throw new Error(
      "Deployer has zero CELO. Fund it with CELO for gas and retry.",
    );
  }

  const plotPrice = hre.ethers.parseEther(CELO_PRICE);
  const BaseBoard = await hre.ethers.getContractFactory("BaseBoard");
  console.log(`Deploying (price ${CELO_PRICE} CELO, treasury ${CELO_TREASURY})...`);
  const board = await BaseBoard.deploy(plotPrice, CELO_TREASURY);
  await board.waitForDeployment();

  const address = await board.getAddress();
  const tx = board.deploymentTransaction();
  const receipt = tx ? await tx.wait() : null;
  const deployBlock = receipt ? receipt.blockNumber : 0;

  console.log("\nBaseBoard (Celo) deployed to:", address);
  console.log("Deploy block:", deployBlock);

  // Persist Celo env vars for the Next.js app.
  const envLocalPath = path.resolve(__dirname, "..", ".env.local");
  const entries = {
    NEXT_PUBLIC_CELO_CONTRACT_ADDRESS: address,
    NEXT_PUBLIC_CELO_TREASURY_ADDRESS: CELO_TREASURY,
    NEXT_PUBLIC_CELO_PLOT_PRICE: CELO_PRICE,
    NEXT_PUBLIC_CELO_DEPLOY_BLOCK: String(deployBlock),
  };

  let existing = "";
  try {
    existing = fs.readFileSync(envLocalPath, "utf-8");
  } catch {
    /* file may not exist yet */
  }
  for (const [key, val] of Object.entries(entries)) {
    const line = `${key}=${val}`;
    if (new RegExp(`^${key}=`, "m").test(existing)) {
      existing = existing.replace(new RegExp(`^${key}=.*$`, "m"), line);
    } else {
      const nl = existing.endsWith("\n") || existing === "" ? "" : "\n";
      existing = existing + nl + line + "\n";
    }
  }
  fs.writeFileSync(envLocalPath, existing, "utf-8");

  console.log("\nWritten Celo env vars to .env.local:");
  for (const [k, v] of Object.entries(entries)) console.log(`  ${k}=${v}`);
  console.log(
    "\nSet these same vars in Vercel and redeploy so the live app uses the real Celo contract.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
