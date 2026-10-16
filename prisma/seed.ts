import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../src/lib/db";

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL ?? "admin@ledgerdesk.local";
  const password = process.env.SUPER_ADMIN_PASSWORD ?? "ChangeMe_SuperAdmin_123!";
  const name = process.env.SUPER_ADMIN_NAME ?? "LedgerDesk Super Admin";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { globalRole: "SUPER_ADMIN", name },
    });
    console.log(`Super admin already exists: ${email}`);
    return;
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      emailVerified: true,
      globalRole: "SUPER_ADMIN",
    },
  });

  const hashed = await hashPassword(password);
  await prisma.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: hashed,
    },
  });

  await prisma.userPreference.create({
    data: { userId: user.id },
  });

  console.log(`Created super admin: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
