/**
 * Command-line indexer: scans `PlotsPurchased` events from chain and writes
 * them (and current plot state) into Turso. Designed to run as a periodic
 * cron job (e.g. every 5 minutes via GitHub Actions, Railway cron, etc.).
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node"}' scripts/index-chain.ts
 *
 * Environment variables:
 *   TURSO_DB_URL          — libsql/Turso database url
 *   TURSO_DB_AUTH_TOKEN   — auth token
 *   RPC_URL               — RPC endpoint (default: https://mainnet.base.org)
 *   CONTRACT_ADDRESS      — BaseBoard contract address
 *   DEPLOY_BLOCK          — block the contract was deployed at (default: 47083347)
 */

import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { createClient } from "@libsql/client";
import {
  ensureSchema,
  getLastScannedBlock,
  setLastScannedBlock,
  upsertPlot,
  insertPurchase,
} from "../src/lib/turso";
import { baseBoardAbi } from "../src/lib/contract";

const RPC_URL = process.env.RPC_URL ?? "https://mainnet.base.org";
const CONTRACT_ADDRESS = (
  process.env.CONTRACT_ADDRESS ?? process.env.NEXT_PUBLIC_BASEBOARD_CONTRACT_ADDRESS ?? "0x0000000000000000000000000000000000000000"
) as `0x${string}`;
const DEPLOY_BLOCK = Number(
  process.env.DEPLOY_BLOCK ?? process.env.NEXT_PUBLIC_BASEBOARD_DEPLOY_BLOCK || "47083347"
);
const LOG_CHUNK = 9_500;
const BATCH_READ_CHUNK = 400;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function isZeroAddr(a: string): boolean {
  return a.toLowerCase() === ZERO_ADDRESS;
}

async function main() {
  const tursoUrl = process.env.TURSO_DB_URL;
  const tursoToken = process.env.TURSO_DB_AUTH_TOKEN;
  if (!tursoUrl || !tursoToken) {
    console.error("Missing TURSO_DB_URL or TURSO_DB_AUTH_TOKEN");
    process.exit(1);
  }

  const turso = createClient({ url: tursoUrl, authToken: tursoToken });
  await ensureSchema(turso);

  const publicClient = createPublicClient({
    chain: base,
    transport: http(RPC_URL, { timeout: 30_000 }),
  });

  const latest = Number(await publicClient.getBlockNumber());
  const lastScanned = await getLastScannedBlock(turso);
  const fromBlock = lastScanned > 0 ? lastScanned + 1 : DEPLOY_BLOCK;

  if (fromBlock > latest) {
    console.log(`No new blocks to scan (last: ${lastScanned}, latest: ${latest})`);
    return;
  }

  console.log(`Scanning blocks ${fromBlock}..${latest}`);
  let totalEvents = 0;
  const seenPlotIds = new Set<number>();

  for (let start = fromBlock; start <= latest; start += LOG_CHUNK + 1) {
    const end = Math.min(start + LOG_CHUNK, latest);
    try {
      const logs = await publicClient.getContractEvents({
        address: CONTRACT_ADDRESS,
        abi: baseBoardAbi,
        eventName: "PlotsPurchased",
        fromBlock: BigInt(start),
        toBlock: BigInt(end),
      });

      for (const log of logs) {
        const args = log.args as {
          buyer?: `0x${string}`;
          plotIds?: readonly bigint[];
        };
        if (!args.buyer || !args.plotIds) continue;

        const blockNumber = Number(log.blockNumber ?? 0n);
        const txHash = log.transactionHash ?? "";
        const buyer = args.buyer.toLowerCase();
        const count = args.plotIds.length;
        const timestamp = Math.floor(Date.now() / 1000);

        for (const b of args.plotIds) {
          seenPlotIds.add(Number(b));
        }

        await insertPurchase(turso, blockNumber, txHash, buyer, count, timestamp);
        totalEvents++;
      }

      console.log(`  Scanned ${start}..${end}: ${logs.length} events`);
    } catch (err) {
      console.error(`  Failed range ${start}..${end}: ${err}`);
    }
  }

  // Now read current state for all plot ids we've seen
  if (seenPlotIds.size > 0) {
    const allIds = Array.from(seenPlotIds).sort((a, b) => a - b);
    const now = Math.floor(Date.now() / 1000);
    let batchCount = 0;

    for (let i = 0; i < allIds.length; i += BATCH_READ_CHUNK) {
      const slice = allIds.slice(i, i + BATCH_READ_CHUNK);
      try {
        const plots = (await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: baseBoardAbi,
          functionName: "getPlotsBatch",
          args: [slice.map((n) => BigInt(n))],
        })) as readonly {
          owner: `0x${string}`;
          price: bigint;
          isForSale: boolean;
          imageUri: string;
        }[];

        for (let j = 0; j < plots.length; j++) {
          const p = plots[j];
          const plotId = slice[j];
          await upsertPlot(
            turso,
            plotId,
            p.owner,
            p.price.toString(),
            p.isForSale,
            p.imageUri,
            now,
          );
        }
        batchCount++;
      } catch (err) {
        console.error(`  Batch read failed at ${i}: ${err}`);
      }
    }

    console.log(`  Updated ${allIds.length} plots in ${batchCount} batches`);
  }

  await setLastScannedBlock(turso, latest);
  console.log(`Done. Scanned ${totalEvents} events up to block ${latest}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
