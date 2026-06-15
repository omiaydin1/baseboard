require("@nomicfoundation/hardhat-toolbox");
require("dotenv/config");

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
// Celo deploys use a dedicated key so the Base key never touches Celo.
const CELO_PRIVATE_KEY =
  process.env.CELO_DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY ?? "";
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const CELO_RPC_URL = process.env.CELO_RPC_URL || "https://forno.celo.org";

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    base: {
      url: BASE_RPC_URL,
      chainId: 8453,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    celo: {
      url: CELO_RPC_URL,
      chainId: 42220,
      accounts: CELO_PRIVATE_KEY ? [CELO_PRIVATE_KEY] : [],
    },
  },
  paths: {
    sources: "./contracts",
    cache: "./hardhat-cache",
    artifacts: "./hardhat-artifacts",
  },
};
