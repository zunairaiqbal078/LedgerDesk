/**
 * Edge-case demo accounts for My Business multi-company + hire accountant.
 *
 * Run: pnpm exec tsx scripts/seed-my-business-edge.ts
 */
import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../src/lib/db";
import { seedOrganizationDefaults } from "../src/lib/org-defaults";
import { slugify } from "../src/lib/utils";

const PASSWORD = "EdgeTest_12345!";

const ACCOUNTS = {
  ownerA: {
    email: "owner.metric@ledgerdesk.test",
    name: "Owner A (Metric+SQL)",
    password: PASSWORD,
  },
  ownerB: {
    email: "owner.widget@ledgerdesk.test",
    name: "Owner B (Widget)",
    password: PASSWORD,
  },
  accountant: {
    email: "accountant.shared@ledgerdesk.test",
    name: "Shared Edge Accountant",
    password: PASSWORD,
  },
} as const;

async function uniqueSlug(base: string) {
  const root = slugify(base) || "company";
  let slug = root;
  let n = 1;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    n += 1;
    slug = `${root}-${n}`;
  }
  return slug;
}

async function upsertCredentialUser(input: {
  email: string;
  name: string;
  password: string;
}) {
  const email = input.email.toLowerCase();
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: input.name,
        email,
        emailVerified: true,
        globalRole: "USER",
      },
    });
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: { name: input.name, emailVerified: true },
    });
  }

  const hashed = await hashPassword(input.password);
  const account = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
  });
  if (account) {
    await prisma.account.update({
      where: { id: account.id },
      data: { password: hashed },
    });
  } else {
    await prisma.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: hashed,
      },
    });
  }

  return user;
}

async function ensureSoloCompany(input: {
  ownerId: string;
  name: string;
  province?: string;
}) {
  const existing = await prisma.organization.findFirst({
    where: {
      name: input.name,
      kind: "CLIENT",
      firmOrganizationId: null,
      members: { some: { userId: input.ownerId, role: "OWNER" } },
    },
  });
  if (existing) return existing;

  const org = await prisma.organization.create({
    data: {
      name: input.name,
      slug: await uniqueSlug(input.name),
      kind: "CLIENT",
      firmOrganizationId: null,
      defaultProvince: input.province ?? "AB",
      members: {
        create: { userId: input.ownerId, role: "OWNER" },
      },
    },
  });
  await seedOrganizationDefaults(prisma, org.id);
  return org;
}

async function ensureMembership(input: {
  organizationId: string;
  userId: string;
  role: "BOOKKEEPER" | "ADMIN" | "VIEWER";
  createdById: string;
}) {
  const existing = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
  });
  if (existing) return existing;
  return prisma.membership.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      role: input.role,
      createdById: input.createdById,
    },
  });
}

async function ensureBank(organizationId: string, name: string, mask: string) {
  const existing = await prisma.bankAccount.findFirst({
    where: { organizationId, name },
  });
  if (existing) return existing;
  return prisma.bankAccount.create({
    data: {
      organizationId,
      name,
      type: "BANK",
      mask,
      currency: "CAD",
      institutionName: "Edge Test Bank",
    },
  });
}

async function clearDemoTransactions(organizationId: string, marker: string) {
  await prisma.transaction.deleteMany({
    where: {
      organizationId,
      description: { contains: marker },
    },
  });
}

async function seedTransactions(
  organizationId: string,
  bankAccountId: string,
  marker: string,
  rows: Array<{ date: string; description: string; moneyIn?: number; moneyOut?: number }>,
) {
  await clearDemoTransactions(organizationId, marker);
  for (const row of rows) {
    await prisma.transaction.create({
      data: {
        organizationId,
        bankAccountId,
        date: new Date(row.date),
        description: `${marker} ${row.description}`,
        moneyIn: row.moneyIn ?? 0,
        moneyOut: row.moneyOut ?? 0,
        accountNumber: "4000",
        accountName: "Sales",
        province: "AB",
        notes: "Edge-case seed data — safe to delete",
      },
    });
  }
}

async function main() {
  console.log("Seeding My Business edge-case accounts…\n");

  const ownerA = await upsertCredentialUser(ACCOUNTS.ownerA);
  const ownerB = await upsertCredentialUser(ACCOUNTS.ownerB);
  const accountant = await upsertCredentialUser(ACCOUNTS.accountant);

  const metric = await ensureSoloCompany({
    ownerId: ownerA.id,
    name: "Metric Ltd",
    province: "AB",
  });
  const sql = await ensureSoloCompany({
    ownerId: ownerA.id,
    name: "SQL Inc",
    province: "BC",
  });
  const widget = await ensureSoloCompany({
    ownerId: ownerB.id,
    name: "Widget Co",
    province: "ON",
  });

  // Hire accountant ONLY on Metric + Widget (NOT on SQL) — isolation edge case
  await ensureMembership({
    organizationId: metric.id,
    userId: accountant.id,
    role: "BOOKKEEPER",
    createdById: ownerA.id,
  });
  await ensureMembership({
    organizationId: widget.id,
    userId: accountant.id,
    role: "BOOKKEEPER",
    createdById: ownerB.id,
  });

  // Ensure accountant is NOT on SQL
  await prisma.membership.deleteMany({
    where: { organizationId: sql.id, userId: accountant.id },
  });

  const metricBank = await ensureBank(metric.id, "Metric Operating", "1111");
  const sqlBank = await ensureBank(sql.id, "SQL Operating", "2222");
  const widgetBank = await ensureBank(widget.id, "Widget Operating", "3333");

  await seedTransactions(metric.id, metricBank.id, "[METRIC]", [
    { date: "2026-01-05", description: "Client invoice payment", moneyIn: 2500 },
    { date: "2026-01-12", description: "Office supplies", moneyOut: 180.5 },
    { date: "2026-01-20", description: "Metric SaaS revenue", moneyIn: 4200 },
  ]);

  await seedTransactions(sql.id, sqlBank.id, "[SQL]", [
    { date: "2026-01-08", description: "Database hosting invoice", moneyOut: 890 },
    { date: "2026-01-15", description: "SQL consulting fee", moneyIn: 6100 },
    { date: "2026-01-22", description: "Cloud backups", moneyOut: 240 },
  ]);

  await seedTransactions(widget.id, widgetBank.id, "[WIDGET]", [
    { date: "2026-01-03", description: "Widget wholesale sale", moneyIn: 1750 },
    { date: "2026-01-18", description: "Shipping costs", moneyOut: 320.75 },
    { date: "2026-01-25", description: "Retail return", moneyOut: 95 },
  ]);

  await prisma.userPreference.upsert({
    where: { userId: ownerA.id },
    create: { userId: ownerA.id, activeOrganizationId: metric.id },
    update: { activeOrganizationId: metric.id, activeBankAccountId: null },
  });
  await prisma.userPreference.upsert({
    where: { userId: ownerB.id },
    create: { userId: ownerB.id, activeOrganizationId: widget.id },
    update: { activeOrganizationId: widget.id, activeBankAccountId: null },
  });
  await prisma.userPreference.upsert({
    where: { userId: accountant.id },
    create: { userId: accountant.id, activeOrganizationId: metric.id },
    update: { activeOrganizationId: metric.id, activeBankAccountId: null },
  });

  console.log("────────────────────────────────────────");
  console.log("CREDENTIALS (password for all):", PASSWORD);
  console.log("────────────────────────────────────────");
  console.log("");
  console.log("1) My Business Owner A — two companies");
  console.log("   Email:", ACCOUNTS.ownerA.email);
  console.log("   Companies: Metric Ltd + SQL Inc (sidebar switcher)");
  console.log("   Expect: see BOTH Metric & SQL; data tagged [METRIC] vs [SQL]");
  console.log("   Hired accountant only on Metric — Settings on Metric shows hire;");
  console.log("   SQL should NOT list the shared accountant unless hired again.");
  console.log("");
  console.log("2) My Business Owner B — one company");
  console.log("   Email:", ACCOUNTS.ownerB.email);
  console.log("   Company: Widget Co — data tagged [WIDGET]");
  console.log("");
  console.log("3) Shared accountant (hired on Metric + Widget only)");
  console.log("   Email:", ACCOUNTS.accountant.email);
  console.log("   Expect sidebar: Metric Ltd + Widget Co only");
  console.log("   Expect: CANNOT see SQL Inc");
  console.log("   Expect: switch Metric ↔ Widget → descriptions stay [METRIC] / [WIDGET]");
  console.log("────────────────────────────────────────");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
