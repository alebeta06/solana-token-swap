import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 🇪🇸 NOTA: hay dos yarn.lock (la raíz del repo y este frontend). Sin esto
  // Next elige el de la raíz como workspace root y avisa en cada build.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
