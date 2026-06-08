/** On-chain plot record (mirrors the Solidity `Plot` struct). */
export interface Plot {
  owner: `0x${string}`;
  price: bigint;
  isForSale: boolean;
  imageUri: string;
}

/** A plot enriched with its grid coordinates and id. */
export interface PlotWithMeta extends Plot {
  plotId: number;
  x: number;
  y: number;
}

/** Status of a transaction lifecycle, used to drive spinners / toasts. */
export type TxStatus = "idle" | "pending" | "confirming" | "success" | "error";
