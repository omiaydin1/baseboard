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

import { createPublicClient, encodePacked, http, keccak256, namehash, toHex } from "viem";
import { base } from "viem/chains";
import { createClient } from "@libsql/client";
import {
  ensureSchema,
  getBasenames,
  getLastScannedBlock,
  setLastScannedBlock,
  upsertPlot,
  upsertBasename,
  insertPurchase,
} from "../src/lib/turso";
import { baseBoardAbi } from "../src/lib/contract";

const RPC_URL = process.env.RPC_URL ?? "https://api.developer.coinbase.com/rpc/v1/base/A9A5uvKtQoPuhzJ42DUmgIb7ocEID6Km";
const CONTRACT_ADDRESS = (
  process.env.CONTRACT_ADDRESS ?? process.env.NEXT_PUBLIC_BASEBOARD_CONTRACT_ADDRESS ?? "0x0000000000000000000000000000000000000000"
) as `0x${string}`;
const DEPLOY_BLOCK = Number(
  process.env.DEPLOY_BLOCK ?? (process.env.NEXT_PUBLIC_BASEBOARD_DEPLOY_BLOCK || "47083347")
);
const LOG_CHUNK = 2_500;
const BATCH_READ_CHUNK = 400;
const MAX_RETRIES = 5;
const INITIAL_BACKOFF = 2000;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BASENAME_L2_RESOLVER = "0xC6d566A56A1aFf6508b41f6c90ff131615583BCD" as const;

const L2_RESOLVER_ABI = [
  {
    inputs: [{ name: "node", type: "bytes32" }],
    name: "name",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

function isZeroAddr(a: string): boolean {
  return a.toLowerCase() === ZERO_ADDRESS;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry<T>(
  label: string,
  fn: () => Promise<T>,
  retries = MAX_RETRIES,
  backoff = INITIAL_BACKOFF,
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isRateLimit =
        err?.details?.includes?.("rate limit") ||
        err?.message?.includes?.("rate limit") ||
        err?.shortMessage?.includes?.("rate limit") ||
        err?.details?.includes?.("over rate limit") ||
        err?.shortMessage?.includes?.("over rate limit") ||
        err?.message?.includes?.("over rate limit");
      if (isRateLimit && attempt < retries) {
        console.log(`  ${label} rate limited, retrying in ${backoff}ms (attempt ${attempt}/${retries})...`);
        await sleep(backoff);
        backoff *= 2;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${label} failed after ${retries} retries`);
}

function chainCoinType(chainId: number): string {
  return ((0x80000000 | chainId) >>> 0).toString(16).toUpperCase();
}

function reverseNode(address: string, chainId: number): `0x${string}` {
  // Basenames L2 resolver expects the ASCII hash of the hex address string,
  // NOT the raw 20-byte hash. OnchainKit uses the same approach internally.
  const addrLabel = keccak256(toHex(address.toLowerCase().slice(2)));
  const baseReverse = namehash(`${chainCoinType(chainId)}.reverse`);
  return keccak256(
    encodePacked(["bytes32", "bytes32"], [baseReverse, addrLabel]),
  );
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
      const logs = await fetchWithRetry(`events ${start}..${end}`, () =>
        publicClient.getContractEvents({
          address: CONTRACT_ADDRESS,
          abi: baseBoardAbi,
          eventName: "PlotsPurchased",
          fromBlock: BigInt(start),
          toBlock: BigInt(end),
        }),
      );

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
  const uniqueOwners = new Set<string>();
  if (seenPlotIds.size > 0) {
    const allIds = Array.from(seenPlotIds).sort((a, b) => a - b);
    const now = Math.floor(Date.now() / 1000);
    let batchCount = 0;

    for (let i = 0; i < allIds.length; i += BATCH_READ_CHUNK) {
      const slice = allIds.slice(i, i + BATCH_READ_CHUNK);
      try {
        const plots = (await fetchWithRetry(`getPlotsBatch ${slice[0]}..${slice[slice.length - 1]}`, () =>
          publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: baseBoardAbi,
            functionName: "getPlotsBatch",
            args: [slice.map((n) => BigInt(n))],
          }),
        )) as readonly {
          owner: `0x${string}`;
          price: bigint;
          isForSale: boolean;
          imageUri: string;
        }[];

        for (let j = 0; j < plots.length; j++) {
          const p = plots[j];
          const plotId = slice[j];
          const owner = p.owner.toLowerCase();
          await upsertPlot(
            turso,
            plotId,
            owner,
            p.price.toString(),
            p.isForSale,
            p.imageUri,
            now,
          );
          if (!isZeroAddr(owner)) uniqueOwners.add(owner);
        }
        batchCount++;
      } catch (err) {
        console.error(`  Batch read failed at ${i}: ${err}`);
      }
    }

    console.log(`  Updated ${allIds.length} plots in ${batchCount} batches`);

    // Resolve basenames for unique owners. Skip those already in the DB to
    // avoid re-resolving every scan cycle (the stored name is authoritative
    // until a new scan re-encounters the owner and re-resolves).
    if (uniqueOwners.size > 0) {
      const existingMap = await getBasenames(turso, Array.from(uniqueOwners));
      const toResolve = Array.from(uniqueOwners).filter(
        (a) => !existingMap.has(a),
      );
      console.log(
        `  Resolving basenames for ${toResolve.length} new owners (${existingMap.size} cached)...`,
      );
      const NAME_CHUNK = 10;
      let resolved = 0;
      for (let i = 0; i < toResolve.length; i += NAME_CHUNK) {
        const chunk = toResolve.slice(i, i + NAME_CHUNK);
        const results = await Promise.allSettled(
          chunk.map(async (addr) => {
            try {
              const name = await publicClient.readContract({
                address: BASENAME_L2_RESOLVER,
                abi: L2_RESOLVER_ABI,
                functionName: "name",
                args: [reverseNode(addr, base.id)],
              });
              return { addr, name: (name as string) || null };
            } catch {
              return { addr, name: null as string | null };
            }
          }),
        );
        for (const r of results) {
          if (r.status === "fulfilled") {
            await upsertBasename(turso, r.value.addr, r.value.name, now);
            if (r.value.name) resolved++;
          }
        }
        if (i + NAME_CHUNK < toResolve.length)
          await new Promise((r) => setTimeout(r, 500));
      }
      console.log(`  Basenames resolved: ${resolved}/${toResolve.length} new`);
    }
  }

  await setLastScannedBlock(turso, latest);
  console.log(`Done. Scanned ${totalEvents} events up to block ${latest}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
