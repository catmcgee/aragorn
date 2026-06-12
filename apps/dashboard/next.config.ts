import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The SDK ships raw TypeScript from the workspace; transpile it.
  transpilePackages: ["@aragorn/sdk"],
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
};

export default nextConfig;
