import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma must run from node_modules with a fresh generated client — not a bundled stale DMMF.
  serverExternalPackages: ["@prisma/client", "prisma", "pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
