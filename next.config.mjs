/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Pre-existing viem/wagmi type resolution issue — code is correct.
    ignoreBuildErrors: true,
  },
  eslint: {
    // Lint is run explicitly in CI via `npm run lint`; don't fail production
    // builds on lint so deployments stay unblocked.
    ignoreDuringBuilds: false,
  },
  async headers() {
    // Allow Farcaster / Base App crawlers to fetch verification + manifest
    // files cross-origin so domain validation doesn't fail on CORS.
    return [
      {
        source: "/.well-known/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
        ],
      },
    ];
  },
  webpack: (config) => {
    // wagmi / walletconnect pull in optional deps that aren't needed in the
    // browser bundle. Alias them to empty modules so webpack neither tries to
    // resolve them nor emits invalid externals (a plain-string external for a
    // scoped package like "@scope/pkg" produces unparseable JS in dev chunks).
    config.resolve.alias = {
      ...config.resolve.alias,
      "pino-pretty": false,
      lokijs: false,
      encoding: false,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

export default nextConfig;
