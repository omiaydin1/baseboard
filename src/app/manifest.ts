import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BaseBoard",
    short_name: "BaseBoard",
    description:
      "Buy, sell, trade and draw on a 10-million-plot pixel board on Base Mainnet.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0052FF",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
