import { NextRequest, NextResponse } from "next/server";
import { http, createPublicClient, keccak256, namehash, encodePacked } from "viem";
import { base } from "viem/chains";

const RESOLVER_ADDRESS = "0xC6d566A56A1aFf6508b41f6c90ff131615583BCD";

const L2_RESOLVER_ABI = [
  {
    inputs: [{ internalType: "bytes32", name: "node", type: "bytes32" }],
    name: "name",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const BASE_RPCS = [
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://base.drpc.org",
];

function getClient() {
  return createPublicClient({
    chain: base,
    transport: http(BASE_RPCS[Math.floor(Math.random() * BASE_RPCS.length)]),
  });
}

function coinTypeHex(chainId: number): string {
  const cointype = (2147483648 | chainId) >>> 0;
  return cointype.toString(16).toUpperCase();
}

function reverseNodeFor(address: `0x${string}`, chainId: number): `0x${string}` {
  const addressNode = keccak256(address.toLowerCase().slice(2));
  const baseReverseNode = namehash(`${coinTypeHex(chainId)}.reverse`);
  return keccak256(encodePacked(["bytes32", "bytes32"], [baseReverseNode, addressNode]));
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  const addressesParam = req.nextUrl.searchParams.get("addresses");

  try {
    if (address) {
      const client = getClient();
      const node = reverseNodeFor(address as `0x${string}`, base.id);
      const name = await client.readContract({
        address: RESOLVER_ADDRESS,
        abi: L2_RESOLVER_ABI,
        functionName: "name",
        args: [node],
      });
      return NextResponse.json({
        address,
        name: name && name.length > 0 ? name : null,
      });
    }

    if (addressesParam) {
      const addresses = (addressesParam
        .split(",")
        .map((a) => a.trim())
        .filter((a) => a.startsWith("0x")) as `0x${string}`[]);
      const client = getClient();
      const results = await Promise.allSettled(
        addresses.map((addr) =>
          client.readContract({
            address: RESOLVER_ADDRESS,
            abi: L2_RESOLVER_ABI,
            functionName: "name",
            args: [reverseNodeFor(addr, base.id)],
          }),
        ),
      );
      const names: Record<string, string | null> = {};
      for (let i = 0; i < addresses.length; i++) {
        const value =
          results[i].status === "fulfilled" ? results[i].value : "";
        names[addresses[i].toLowerCase()] =
          value && value.length > 0 ? value : null;
      }
      return NextResponse.json({ names });
    }

    return NextResponse.json(
      { error: "Missing 'address' or 'addresses' param" },
      { status: 400 },
    );
  } catch (err) {
    const e = err as any;
    const detail = [
      "msg:", e.message,
      "| shortMessage:", e.shortMessage,
      "| cause:", e.cause?.message,
      "| code:", e.code,
      "| details:", e.details,
      "| name:", e.name,
    ].join(" ");
    console.error("Basename API error:", detail);
    return NextResponse.json({ error: "Resolution failed", detail }, { status: 500 });
  }
}
