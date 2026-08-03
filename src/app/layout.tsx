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

const SITE_TITLE = "BaseBoard · 9,998,244 pixels on Base";
const SITE_DESCRIPTION =
  "Buy a pixel and draw on a 9,998,244-pixel community board on Base Mainnet.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: APP_URL,
    siteName: "BaseBoard",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  // Icons are served via App Router file-based metadata
  // (app/favicon.ico, app/icon.png, app/apple-icon.png) — no manual `icons`
  // array so the auto-detected files are the single source of truth.
  other: {
    "base:app_id": "6a29aec065478aa1565a99bb",
    "talentapp:project_verification":
      "cd5f74f844402d75645d622fd73fe10225844494750f5977da781720a9008431b98c3d10e1d7edba21673c7b736162c63e456dc3f2b93ffa0d51ca3b5927f63c",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0052FF",
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
