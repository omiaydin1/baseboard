/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Lint is run explicitly in CI via `npm run lint`; don't fail production
    // builds on lint so deployments stay unblocked.
    ignoreDuringBuilds: false,
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
