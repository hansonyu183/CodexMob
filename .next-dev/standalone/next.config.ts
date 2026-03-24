import type { NextConfig } from "next";

const rawBasePath = process.env.NEXT_BASE_PATH?.trim();
const rawDistDir = process.env.NEXT_DIST_DIR?.trim();
const basePath =
  rawBasePath && rawBasePath !== "/"
    ? rawBasePath.startsWith("/")
      ? rawBasePath
      : `/${rawBasePath}`
    : undefined;
const distDir = rawDistDir ? rawDistDir : undefined;

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  ...(basePath ? { basePath } : {}),
  ...(distDir ? { distDir } : {}),
};

export default nextConfig;
