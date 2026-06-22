import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@coinbase/onchainkit/styles.css";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { APP_URL } from "@/lib/constants";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: "BaseBoard · 10,000,000 plots on Base",
  description:
    "Buy, sell, trade and draw on a 10-million-plot pixel board on Base Mainnet.",
  manifest: "/manifest.webmanifest",
  // Force every browser/dApp chrome (incl. the BaseApp / Coinbase Wallet
  // in-app browser nav bar) to fetch the custom pixelated blue "B" logo
  // (Görsel 5) instead of a framework default.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: "/icon-192.png",
    apple: "/apple-icon.png",
  },
  other: {
    "base:app_id": "6a29aec065478aa1565a99bb",
    "talentapp:project_verification":
      "cd5f74f844402d75645d622fd73fe10225844494750f5977da781720a9008431b98c3d10e1d7edba21673c7b736162c63e456dc3f2b93ffa0d51ca3b5927f63c",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-white font-sans text-slate-900 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
