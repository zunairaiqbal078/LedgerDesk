/// <reference types="node" />
/**
 * Verifies General Entries sees transactions saved across multiple folders.
 *
 *   pnpm exec tsx scripts/test-ge-multi-folder.ts
 */
import { PrismaClient } from "@prisma/client";
import { loadTransactionsForGeneralEntries } from "../src/lib/general-entries-sources";
import { generateAutomaticEntries } from "../src/lib/general-entries";

const prisma = new PrismaClient();

async function main() {
  const tag = `ge-multi-${Date.now()}`;
  console.log(`\n[test-ge-multi-folder] ${tag}\n`);

  const org = await prisma.organization.create({
    data: {
      name: `Test Org ${tag}`,
      slug: tag,
      fiscalYearStartMonth: 1,
      fiscalYearStartDay: 1,
    },
  });

  const bank = await prisma.bankAccount.create({
    data: {
      organizationId: org.id,
      name: "Test Chequing",
      type: "BANK",
    },
  });

  const folders = await Promise.all(
    ["Folder Alpha", "Folder Beta", "Folder Gamma"].map((name) =>
      prisma.folder.create({
        data: { organizationId: org.id, name },
      }),
    ),
  );

  const snapshotRows = [
    {
      folder: folders[0],
      name: "Save A",
      tx: {
        id: `tx-a-${tag}`,
        date: "2025-03-01",
        description: "Alpha deposit",
        moneyIn: 100,
        moneyOut: 0,
        accountNumber: "4000",
        accountName: "Sales",
        taxCodes: [] as string[],
        taxMode: "INCLUSIVE",
      },
    },
    {
      folder: folders[1],
      name: "Save B",
      tx: {
        id: `tx-b-${tag}`,
        date: "2025-03-02",
        description: "Beta expense",
        moneyIn: 0,
        moneyOut: 50,
        accountNumber: "5100",
        accountName: "Office Expenses",
        taxCodes: [] as string[],
        taxMode: "INCLUSIVE",
      },
    },
    {
      folder: folders[2],
      name: "Save C",
      tx: {
        id: `tx-c-${tag}`,
        date: "2025-03-03",
        description: "Gamma deposit",
        moneyIn: 200,
        moneyOut: 0,
        accountNumber: "4000",
        accountName: "Sales",
        taxCodes: [] as string[],
        taxMode: "INCLUSIVE",
      },
    },
  ];

  for (const row of snapshotRows) {
    await prisma.savedConversion.create({
      data: {
        folderId: row.folder.id,
        name: row.name,
        snapshot: {
          version: 1,
          savedAt: new Date().toISOString(),
          organizationId: org.id,
          organizationName: org.name,
          bankAccountId: bank.id,
          transactionCount: 1,
          transactions: [
            {
              ...row.tx,
              bankAccountId: bank.id,
              province: null,
              provinceTaxCodes: [],
              notes: null,
              externalTransactionId: null,
              transferMatchId: null,
            },
          ],
          settings: { rules: [], taxCodes: [], accounts: [] },
        },
      },
    });
  }

  // No live transactions — only folder snapshots (typical after save + clear / other bank).
  const liveCount = await prisma.transaction.count({ where: { organizationId: org.id } });
  if (liveCount !== 0) {
    throw new Error(`Expected 0 live txs, got ${liveCount}`);
  }

  const loaded = await loadTransactionsForGeneralEntries(prisma, org.id);
  console.log(`Loaded ${loaded.length} transaction(s) for General Entries`);

  if (loaded.length !== 3) {
    throw new Error(
      `Expected 3 transactions from 3 folders, got ${loaded.length}: ${loaded.map((t) => t.description).join(", ")}`,
    );
  }

  const descriptions = new Set(loaded.map((t) => t.description));
  for (const expected of ["Alpha deposit", "Beta expense", "Gamma deposit"]) {
    if (!descriptions.has(expected)) {
      throw new Error(`Missing snapshot transaction: ${expected}`);
    }
  }

  const entries = generateAutomaticEntries(loaded, {
    periodType: "CUSTOM",
    taxRateByCode: new Map(),
    customStart: new Date("2025-03-01T00:00:00.000Z"),
    customEnd: new Date("2025-03-31T23:59:59.999Z"),
    inputTaxAccount: null,
    outputTaxAccount: null,
  });

  console.log(`Generated ${entries.length} automatic general entry line(s) from 3 folder snapshots`);
  if (entries.length < 1) {
    throw new Error("generateAutomaticEntries returned no lines for 3 loaded transactions");
  }

  // Dedup: same tx saved twice in two folders should count once.
  await prisma.savedConversion.create({
    data: {
      folderId: folders[0].id,
      name: "Duplicate snapshot",
      snapshot: {
        version: 1,
        bankAccountId: bank.id,
        transactions: [
          {
            id: `tx-a-${tag}`,
            bankAccountId: bank.id,
            date: "2025-03-01",
            description: "Alpha deposit",
            moneyIn: 100,
            moneyOut: 0,
            accountNumber: "4000",
            accountName: "Sales",
            taxCodes: [],
            taxMode: "INCLUSIVE",
          },
        ],
      },
    },
  });

  const afterDup = await loadTransactionsForGeneralEntries(prisma, org.id);
  if (afterDup.length !== 3) {
    throw new Error(`After duplicate snapshot, expected 3 txs, got ${afterDup.length}`);
  }

  // Simulates loading folder A into Transactions (live copy) — GE must not double-count.
  await prisma.transaction.create({
    data: {
      organizationId: org.id,
      bankAccountId: bank.id,
      date: new Date("2025-03-01T12:00:00.000Z"),
      description: "Alpha deposit",
      moneyIn: 100,
      moneyOut: 0,
      accountNumber: "4000",
      accountName: "Sales",
      taxCodes: [],
      taxMode: "INCLUSIVE",
    },
  });
  await prisma.transaction.create({
    data: {
      organizationId: org.id,
      bankAccountId: bank.id,
      date: new Date("2025-06-15T12:00:00.000Z"),
      description: "Unsaved import row",
      moneyIn: 0,
      moneyOut: 25,
      accountNumber: "5100",
      accountName: "Office Expenses",
      taxCodes: [],
      taxMode: "INCLUSIVE",
    },
  });
  const withLive = await loadTransactionsForGeneralEntries(prisma, org.id);
  if (withLive.length !== 4) {
    throw new Error(
      `Expected 3 saved + 1 unsaved live, got ${withLive.length}: ${withLive.map((t) => t.description).join(", ")}`,
    );
  }
  if (!withLive.some((t) => t.description === "Unsaved import row")) {
    throw new Error("Missing unsaved live-only transaction");
  }

  console.log("\n✓ Multi-folder General Entries source: PASS\n");

  await prisma.organization.delete({ where: { id: org.id } });
}

main()
  .catch((err) => {
    console.error("\n✗ FAIL:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
