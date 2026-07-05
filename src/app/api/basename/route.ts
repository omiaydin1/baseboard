import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, toCoinType } from "viem";
import { mainnet, base } from "viem/chains";

const RPCS = [
  "https://rpc.ankr.com/eth",
  "https://1rpc.io/eth",
  "https://eth.drpc.org",
];

function getClient() {
  return createPublicClient({
    chain: mainnet,
    transport: http(RPCS[Math.floor(Math.random() * RPCS.length)]),
  });
}

/**
 * Resolves Basenames for one or more addresses via ENSIP-19 cross-chain
 * resolution on Ethereum mainnet (no CCIP-read gateway needed).
 *
 * GET /api/basename?address=0x...
 * GET /api/basename?addresses=0x...,0x...
 */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  const addressesParam = req.nextUrl.searchParams.get("addresses");

  try {
    if (address) {
      const client = getClient();
      const name = await client.getEnsName({
        address: address as `0x${string}`,
        coinType: toCoinType(base.id),
      });
      return NextResponse.json({ address, name: name ?? null });
    }

    if (addressesParam) {
      const addresses = addressesParam
        .split(",")
        .map((a) => a.trim())
        .filter((a) => a.startsWith("0x")) as `0x${string}`[];
      const client = getClient();
      const results = await Promise.allSettled(
        addresses.map((addr) =>
          client.getEnsName({ address: addr, coinType: toCoinType(base.id) }),
        ),
      );
      const names: Record<string, string | null> = {};
      for (let i = 0; i < addresses.length; i++) {
        names[addresses[i]] =
          results[i].status === "fulfilled" ? results[i].value : null;
      }
      return NextResponse.json({ names });
    }

    return NextResponse.json({ error: "Missing 'address' or 'addresses' param" }, { status: 400 });
  } catch (err) {
    console.error("Basename API error:", err);
    return NextResponse.json({ error: "Resolution failed" }, { status: 500 });
  }
}
