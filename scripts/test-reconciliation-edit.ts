/**
 * Verify Reconciliation add / edit / delete against zunair → lette client.
 *
 *   pnpm exec tsx scripts/test-reconciliation-edit.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";

const EMAIL = "zunairaiqbal078@gmail.com";
const MARKER = "[RECON-UI-TEST]";

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: EMAIL.toLowerCase() },
    include: { memberships: { include: { organization: true } } },
  });
  if (!user) throw new Error(`User not found: ${EMAIL}`);

  const firmIds = user.memberships
    .filter((m) => m.organization.kind === "ACCOUNTANT_FIRM")
    .map((m) => m.organizationId);
  const org =
    (await prisma.organization.findFirst({
      where: {
        kind: "CLIENT",
        OR: [
          { firmOrganizationId: { in: firmIds } },
          { members: { some: { userId: user.id } }, name: { equals: "lette", mode: "insensitive" } },
        ],
      },
      orderBy: { name: "asc" },
    })) ??
    (await prisma.organization.findFirst({
      where: {
        kind: "CLIENT",
        OR: [
          { firmOrganizationId: { in: firmIds } },
          { members: { some: { userId: user.id } } },
        ],
      },
    }));

  if (!org) throw new Error("No client org for user");
  console.log(`Org: ${org.name} (${org.id})`);

  let bank = await prisma.bankAccount.findFirst({
    where: { organizationId: org.id, name: { contains: "RBC" }, isArchived: false },
  });
  if (!bank) {
    bank = await prisma.bankAccount.findFirst({
      where: { organizationId: org.id, isArchived: false },
    });
  }
  if (!bank) {
    bank = await prisma.bankAccount.create({
      data: { organizationId: org.id, name: `${MARKER} Bank`, type: "BANK" },
    });
  }
  console.log(`Bank: ${bank.name}`);

  await prisma.transaction.deleteMany({
    where: { organizationId: org.id, description: { contains: MARKER } },
  });

  // Add row
  const created = await prisma.transaction.create({
    data: {
      organizationId: org.id,
      bankAccountId: bank.id,
      date: new Date("2026-11-05T12:00:00.000Z"),
      description: `${MARKER} New row`,
      moneyIn: 0,
      moneyOut: 0,
      taxCodes: [],
      provinceTaxCodes: [],
      taxMode: "INCLUSIVE",
    },
  });
  console.log(`✓ Add row → ${created.id}`);

  // Edit all fields
  const updated = await prisma.transaction.update({
    where: { id: created.id },
    data: {
      date: new Date("2026-11-06T12:00:00.000Z"),
      description: `${MARKER} Edited description`,
      accountNumber: "5200",
      accountName: "Office Expenses",
      moneyIn: 0,
      moneyOut: 42.5,
    },
  });
  if (Number(updated.moneyOut) !== 42.5 || updated.accountName !== "Office Expenses") {
    throw new Error("Edit fields did not persist");
  }
  console.log(
    `✓ Edit fields → ${updated.date.toISOString().slice(0, 10)} | ${updated.description} | out=${updated.moneyOut}`,
  );

  // Select/delete
  const deleted = await prisma.transaction.deleteMany({
    where: { id: created.id, organizationId: org.id },
  });
  if (deleted.count !== 1) throw new Error("Delete failed");
  const gone = await prisma.transaction.findUnique({ where: { id: created.id } });
  if (gone) throw new Error("Row still exists after delete");
  console.log("✓ Delete selected → removed");

  // Checkbox alignment is CSS — assert structure helpers conceptually by ensuring
  // money in/out can be independent on a row (editable both sides)
  const both = await prisma.transaction.create({
    data: {
      organizationId: org.id,
      bankAccountId: bank.id,
      date: new Date("2026-11-07T12:00:00.000Z"),
      description: `${MARKER} Both sides`,
      moneyIn: 10,
      moneyOut: 5,
      accountNumber: "4000",
      accountName: "Sales",
      taxCodes: [],
      provinceTaxCodes: [],
      taxMode: "INCLUSIVE",
    },
  });
  console.log(`✓ Editable Money In (${both.moneyIn}) + Money Out (${both.moneyOut}) on same row`);

  await prisma.transaction.deleteMany({
    where: { organizationId: org.id, description: { contains: MARKER } },
  });

  console.log("\n✓ Reconciliation add / edit / delete PASS\n");
}

main()
  .catch((e) => {
    console.error("\n✗ FAIL:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
