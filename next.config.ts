import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma must run from node_modules with a fresh generated client — not a bundled stale DMMF.
  serverExternalPackages: ["@prisma/client", "prisma", "pdf-parse", "pdfjs-dist"],
  experimental: {
    // Scanned / AI PDF imports can send large JSON payloads in the import server action.
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
  async redirects() {
    return [{ source: "/app/banks", destination: "/app", permanent: true }];
  },
};

export default nextConfig;
