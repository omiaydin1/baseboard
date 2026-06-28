import type { MetadataRoute } from "next";
import { ICON_CACHE_BUST } from "@/lib/constants";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BaseBoard",
    short_name: "BaseBoard",
    description:
      "Buy, sell, trade and draw on a 9,998,244-pixel board on Base Mainnet.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0052FF",
    icons: [
      {
        src: `/icon-v2-192.png${ICON_CACHE_BUST}`,
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: `/icon-v2-512.png${ICON_CACHE_BUST}`,
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
