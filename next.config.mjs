// @ts-check
import "./src/env-config.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  distDir: process.env.GH_NEXT_E2E === "1" ? ".next-e2e" : ".next",
  cacheHandler:
    process.env.NODE_ENV === "production"
      ? "./custom-incremental-cache-handler.mjs"
      : undefined,
  cacheMaxMemorySize: 0,
  experimental: {
    taint: true
  },
  logging: {
    fetches: {
      fullUrl: true
    }
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com"
      }
    ]
  }
};

export default nextConfig;
