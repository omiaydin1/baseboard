/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Type-check is run separately via `npm run typecheck`.
    ignoreBuildErrors: false,
  },
  eslint: {
    // Lint is run explicitly in CI via `npm run lint`; don't fail production
    // builds on lint so deployments stay unblocked.
    ignoreDuringBuilds: false,
  },
  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-XSS-Protection", value: "1; mode=block" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    return [
      {
        source: "/.well-known/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
          ...securityHeaders,
        ],
      },
      {
        source: "/(.*)",
        headers: securityHeaders,
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
    // Suppress the ox/tempo "Critical dependency: the request of a dependency
    // is an expression" warning from viem's optional tempo chain config.
    config.module.exprContextCritical = false;
    return config;
  },
};

export default nextConfig;
