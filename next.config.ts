import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This tells Next/Vercel: "even if you don't detect these via imports,
  // include them in the serverless function bundle."
  experimental: {
    outputFileTracingIncludes: {
      // Key is the route pathname (works like pages/api style)
      "/api/export": [
        "./exporter/**",

        // Force include the packages the exporter imports at runtime:
        "./node_modules/commander/**",
        "./node_modules/ethers/**",
        "./node_modules/@gltf-transform/**",
      ],
    },
  },
};

export default nextConfig;