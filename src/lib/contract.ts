import { CONTRACT_ADDRESS } from "./constants";

/** Address of the deployed BaseBoard contract. */
export const baseBoardAddress = CONTRACT_ADDRESS;

/**
 * ABI for BaseBoard.sol. Kept in sync with `contracts/BaseBoard.sol`.
 */
export const baseBoardAbi = [
  // ----- views -----
  {
    type: "function",
    name: "GRID_SIZE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_PLOTS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "PLOT_PRICE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalPlotsSold",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "remainingPlots",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "plots",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "price", type: "uint256" },
      { name: "isForSale", type: "bool" },
      { name: "imageUri", type: "string" },
    ],
  },
  {
    type: "function",
    name: "getPlot",
    stateMutability: "view",
    inputs: [{ name: "plotId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "price", type: "uint256" },
          { name: "isForSale", type: "bool" },
          { name: "imageUri", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getPlotsBatch",
    stateMutability: "view",
    inputs: [{ name: "plotIds", type: "uint256[]" }],
    outputs: [
      {
        name: "",
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
  {
    type: "function",
    name: "getPlotsByOwner",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "offers",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  // ----- writes -----
  {
    type: "function",
    name: "buyPlots",
    stateMutability: "payable",
    inputs: [{ name: "plotIds", type: "uint256[]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "buyListedPlot",
    stateMutability: "payable",
    inputs: [{ name: "plotId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "listPlot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "plotId", type: "uint256" },
      { name: "price", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelListing",
    stateMutability: "nonpayable",
    inputs: [{ name: "plotId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "updatePlotPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "plotId", type: "uint256" },
      { name: "newPrice", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "placeOffer",
    stateMutability: "payable",
    inputs: [{ name: "plotId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "acceptOffer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "plotId", type: "uint256" },
      { name: "offeror", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelOffer",
    stateMutability: "nonpayable",
    inputs: [{ name: "plotId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "updatePlotImage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "plotId", type: "uint256" },
      { name: "imageUri", type: "string" },
    ],
    outputs: [],
  },
  // ----- events -----
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
    type: "event",
    name: "PlotSold",
    inputs: [
      { name: "plotId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "price", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PlotListed",
    inputs: [
      { name: "plotId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "price", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ListingCancelled",
    inputs: [
      { name: "plotId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "PriceUpdated",
    inputs: [
      { name: "plotId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "newPrice", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OfferPlaced",
    inputs: [
      { name: "plotId", type: "uint256", indexed: true },
      { name: "offeror", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OfferAccepted",
    inputs: [
      { name: "plotId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "offeror", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OfferCancelled",
    inputs: [
      { name: "plotId", type: "uint256", indexed: true },
      { name: "offeror", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ImageUpdated",
    inputs: [
      { name: "plotId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "imageUri", type: "string", indexed: false },
    ],
  },
] as const;
