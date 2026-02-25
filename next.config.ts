import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Force Next/Vercel to include these files in the serverless trace:
  // Keys are route globs matched against the route path (e.g. /api/export)
  outputFileTracingIncludes: {
    "/api/export": [
      "./exporter/**",
      "./node_modules/commander/**",
      "./node_modules/ethers/**",
      "./node_modules/@gltf-transform/**",
    ],
  },
};

export default nextConfig;