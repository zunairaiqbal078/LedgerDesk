import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { Prisma, PrismaClient } from "@prisma/client";

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

/** Regenerate client after `prisma generate` without editing schema.prisma. */
function prismaRuntimeKey() {
  try {
    const tx = Prisma.dmmf.datamodel.models.find((m) => m.name === "Transaction");
    const fieldSig = (tx?.fields ?? []).map((f) => f.name).sort().join("|");
    return createHash("sha256").update(fieldSig).digest("hex").slice(0, 16);
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
const prismaInstanceKey = `${prismaSchemaKey()}:${prismaRuntimeKey()}`;

if (
  process.env.NODE_ENV !== "production" &&
  globalForPrisma.__ledgerdeskPrisma &&
  globalForPrisma.__ledgerdeskPrismaSchemaKey !== prismaInstanceKey
) {
  void globalForPrisma.__ledgerdeskPrisma.$disconnect();
  globalForPrisma.__ledgerdeskPrisma = undefined;
}

export const prisma =
  globalForPrisma.__ledgerdeskPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__ledgerdeskPrisma = prisma;
  globalForPrisma.__ledgerdeskPrismaSchemaKey = prismaInstanceKey;

  const schemaText = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const schemaHasTaxOverrides = schemaText.includes("salesTaxAmountOverride");
  const runtimeHasTaxOverrides = (Prisma.dmmf.datamodel.models
    .find((m) => m.name === "Transaction")
    ?.fields.some((f) => f.name === "salesTaxAmountOverride") ?? false);
  if (schemaHasTaxOverrides && !runtimeHasTaxOverrides) {
    console.warn(
      "[prisma] schema.prisma defines salesTaxAmountOverride but the loaded client does not. Run: pnpm exec prisma generate && rm -rf .next && pnpm dev",
    );
  }
}
