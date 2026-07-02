/**
 * Turso indexer — run on a Vercel Cron Job or scheduled GitHub Action.
 *
 * Reads PlotsPurchased events from the chain, writes them into Turso,
 * and maintains a materialized ownership table for fast reads.
 *
 * Usage: npx tsx scripts/index-chain.ts
 * Requires env vars: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, BASE_RPC_URL,
 *   NEXT_PUBLIC_BASEBOARD_CONTRACT_ADDRESS, NEXT_PUBLIC_BASEBOARD_DEPLOY_BLOCK
 */
import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";
import { createClient } from "@libsql/client";
import "dotenv/config";

// ---- Config ----
const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_BASEBOARD_CONTRACT_ADDRESS ||
  "") as Address;
const DEPLOY_BLOCK = Number(
  process.env.NEXT_PUBLIC_BASEBOARD_DEPLOY_BLOCK || "47083347",
);
const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const TURSO_URL = process.env.TURSO_DATABASE_URL || "";
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || "";

if (!CONTRACT_ADDRESS || !TURSO_URL || !TURSO_AUTH_TOKEN) {
  console.error(
    "Missing required env vars: NEXT_PUBLIC_BASEBOARD_CONTRACT_ADDRESS, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN",
  );
  process.exit(1);
}

// ---- ABI fragments ----
const abi = [
  {
    type: "event",
    name: "PlotsPurchased",
    inputs: [
      { name: "buyer", type: "address", indexed: true },
      { name: "plotIds", type: "uint256[]", indexed: false },
      { name: "totalPaid", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "getPlotsBatch",
    stateMutability: "view",
    inputs: [{ name: "plotIds", type: "uint256[]" }],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "owner", type: "address" },
          { name: "price", type: "uint256" },
          { name: "isForSale", type: "bool" },
          { name: "imageUri", type: "string" },
        ],
      },
    ],
  },
] as const;

// ---- Clients ----
const publicClient = createPublicClient({
  chain: base,
  transport: http(RPC_URL),
});

const turso = createClient({ url: TURSO_URL, authToken: TURSO_AUTH_TOKEN });

// ---- Schema bootstrap ----
async function ensureSchema() {
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS indexer_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      last_indexed_block INTEGER NOT NULL DEFAULT 0
    )
  `);
  await turso.execute(`
    INSERT OR IGNORE INTO indexer_state (id, last_indexed_block)
    VALUES (1, 0)
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer TEXT NOT NULL,
      plot_ids TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      timestamp INTEGER
    )
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS ownership (
      plot_id INTEGER PRIMARY KEY,
      owner TEXT NOT NULL,
      price TEXT NOT NULL DEFAULT '0',
      is_for_sale INTEGER NOT NULL DEFAULT 0,
      image_uri TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  console.log("Schema ensured");
}

// ---- Retry helper (mirrors Part 1 client-side fix) ----
async function retryFetch<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T | null> {
  const delays = [500, 1000, 2000];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[${label}] attempt ${attempt + 1} failed:`, e);
      if (attempt < 2) await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  console.error(`[${label}] all 3 attempts failed`);
  return null;
}

// ---- Indexer logic ----
async function index() {
  await ensureSchema();

  // Read last indexed block
  const state = await turso.execute(
    "SELECT last_indexed_block FROM indexer_state WHERE id = 1",
  );
  const fromBlock =
    (Number(state.rows[0]?.last_indexed_block) || DEPLOY_BLOCK) + 1;
  const latestBlock = Number(await publicClient.getBlockNumber());
  if (fromBlock > latestBlock) {
    console.log(`No new blocks to index (at block ${latestBlock})`);
    return;
  }

  console.log(`Indexing blocks ${fromBlock} to ${latestBlock}`);

  // Scan PlotsPurchased logs (chunked)
  const LOG_CHUNK = 40_000;
  const allPlotIds: Set<number> = new Set();

  for (let start = fromBlock; start <= latestBlock; start += LOG_CHUNK + 1) {
    const end = Math.min(start + LOG_CHUNK, latestBlock);
    const logs = await retryFetch(
      () =>
        publicClient.getContractEvents({
          address: CONTRACT_ADDRESS,
          abi,
          eventName: "PlotsPurchased",
          fromBlock: BigInt(start),
          toBlock: BigInt(end),
        }),
      `logs ${start}-${end}`,
    );
    if (!logs) continue;

    const logEntries = logs as Array<{
      args?: { buyer?: Address; plotIds?: readonly bigint[]; totalPaid?: bigint };
      blockNumber?: bigint;
      transactionHash?: string;
    }>;
    for (const log of logEntries) {
      const args = log.args ?? {};
      const plotIds = (args.plotIds ?? []).map((b) => Number(b));
      const buyer = (args.buyer ?? "").toLowerCase();
      const blockNumber = Number(log.blockNumber ?? 0);
      const txHash = log.transactionHash ?? "";
      plotIds.forEach((id) => allPlotIds.add(id));

      await turso.execute({
        sql: `INSERT INTO purchases (buyer, plot_ids, block_number, tx_hash, timestamp)
              VALUES (?, ?, ?, ?, unixepoch())`,
        args: [buyer, JSON.stringify(plotIds), blockNumber, txHash],
      });
    }
  }

  // Refresh ownership for all discovered plot ids
  console.log(
    `Updating ownership for ${allPlotIds.size} plot ids...`,
  );

  const plotIdsArr = Array.from(allPlotIds);
  const READ_CHUNK = 400;

  for (let i = 0; i < plotIdsArr.length; i += READ_CHUNK) {
    const slice = plotIdsArr.slice(i, i + READ_CHUNK);
    const batchResult = await retryFetch(
      () =>
        publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi,
          functionName: "getPlotsBatch",
          args: [slice.map((n) => BigInt(n))],
        }),
      `ownership ${slice[0]}-${slice[slice.length - 1]}`,
    );
    if (!batchResult) continue;

    const plots = batchResult as Array<{
      owner: Address;
      price: bigint;
      isForSale: boolean;
      imageUri: string;
    }>;

    for (let j = 0; j < plots.length; j++) {
      const plot = plots[j];
      const plotId = slice[j];
      await turso.execute({
        sql: `INSERT INTO ownership (plot_id, owner, price, is_for_sale, image_uri, updated_at)
              VALUES (?, ?, ?, ?, ?, unixepoch())
              ON CONFLICT(plot_id) DO UPDATE SET
                owner = excluded.owner,
                price = excluded.price,
                is_for_sale = excluded.is_for_sale,
                image_uri = excluded.image_uri,
                updated_at = unixepoch()`,
        args: [
          plotId,
          plot.owner.toLowerCase(),
          plot.price.toString(),
          plot.isForSale ? 1 : 0,
          plot.imageUri,
        ],
      });
    }
  }

  // Update last indexed block
  await turso.execute({
    sql: "UPDATE indexer_state SET last_indexed_block = ? WHERE id = 1",
    args: [latestBlock],
  });

  console.log(`Indexing complete at block ${latestBlock}`);
}

index().catch((e) => {
  console.error("Indexer failed:", e);
  process.exit(1);
});
