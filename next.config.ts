import type { NextConfig } from "next";

const buildTime = new Date()
  .toISOString()
  .split("T")
  .join(" ")
  .replace(/\.[0-9]+Z$/, "");

const nextConfig: NextConfig = {
  basePath: "/kosovo_customs_explorer",
  reactStrictMode: true,
  reactCompiler: true,
  output: "export",
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },
};

export default nextConfig;
