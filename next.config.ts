import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma must run from node_modules with a fresh generated client — not a bundled stale DMMF.
  serverExternalPackages: ["@prisma/client", "prisma", "pdf-parse", "pdfjs-dist"],
  async redirects() {
    return [{ source: "/app/banks", destination: "/app", permanent: true }];
  },
};

export default nextConfig;
