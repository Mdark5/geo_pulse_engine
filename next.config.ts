import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained .next/standalone build (minimal node_modules
  // subset + server) so the production Docker image doesn't need a full
  // npm install at runtime.
  output: "standalone",
};

export default nextConfig;
