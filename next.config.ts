import type { NextConfig } from "next";

// STATIC_EXPORT=1 builds a plain static site into out/ (no server needed); the default build is unchanged.
const nextConfig: NextConfig = process.env.STATIC_EXPORT === "1" ? { output: "export", trailingSlash: true } : {};

export default nextConfig;
