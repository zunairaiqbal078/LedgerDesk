import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

type PrismaGlobal = typeof globalThis & {
  __ledgerdeskPrisma?: PrismaClient;
  __ledgerdeskPrismaSchemaKey?: string;
};

function prismaSchemaKey() {
  try {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    return createHash("sha256").update(schema).digest("hex").slice(0, 16);
  } catch {
    return "unknown";
  }
}

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

const globalForPrisma = globalThis as PrismaGlobal;
const schemaKey = prismaSchemaKey();

if (
  process.env.NODE_ENV !== "production" &&
  globalForPrisma.__ledgerdeskPrisma &&
  globalForPrisma.__ledgerdeskPrismaSchemaKey !== schemaKey
) {
  void globalForPrisma.__ledgerdeskPrisma.$disconnect();
  globalForPrisma.__ledgerdeskPrisma = undefined;
}

export const prisma =
  globalForPrisma.__ledgerdeskPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__ledgerdeskPrisma = prisma;
  globalForPrisma.__ledgerdeskPrismaSchemaKey = schemaKey;
}
