/**
 * End-to-end GE multi-folder check for zunairaiqbal078@gmail.com
 * Uses demo Nov 2026 CSVs → 2 banks → 2 folder saves → loadTransactionsForGeneralEntries
 *
 *   pnpm exec tsx scripts/test-zunair-ge-account.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src/lib/db";
import {
  guessMapping,
  mapRowsToTransactions,
  parseCsvText,
} from "../src/lib/import-parser";
import { loadTransactionsForGeneralEntries } from "../src/lib/general-entries-sources";
import { generateAutomaticEntries } from "../src/lib/general-entries";
import { parseGeCustomDateStart, parseGeCustomDateEnd } from "../src/lib/general-entries-sources";

const EMAIL = "zunairaiqbal078@gmail.com";
const MARKER = "[GE-DEMO-NOV-2026]";
const FOLDER_A = `${MARKER} Folder RBC`;
const FOLDER_B = `${MARKER} Folder TD`;
const SAVE_A = `${MARKER} RBC save`;
const SAVE_B = `${MARKER} TD save`;

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: EMAIL.toLowerCase() },
    include: {
      preferences: true,
      memberships: {
        include: { organization: { select: { id: true, name: true, kind: true, slug: true } } },
      },
    },
  });

  if (!user) {
    throw new Error(`User not found: ${EMAIL}`);
  }

  console.log(`\nUser: ${user.name ?? "(no name)"} <${user.email}>`);
  console.log("Memberships:");
  for (const m of user.memberships) {
    console.log(`  - ${m.organization.name} (${m.organization.kind}) role=${m.role} id=${m.organization.id}`);
  }

  const activeOrgId = user.preferences?.activeOrganizationId;
  let targetOrgId = activeOrgId ?? null;

  const activeMembership = user.memberships.find((m) => m.organizationId === activeOrgId);
  if (activeMembership?.organization.kind === "ACCOUNTANT_FIRM") {
    targetOrgId = null;
  }

  if (!targetOrgId) {
    const firmIds = user.memberships
      .filter((m) => m.organization.kind === "ACCOUNTANT_FIRM")
      .map((m) => m.organizationId);
    const clients = await prisma.organization.findMany({
      where: {
        kind: "CLIENT",
        OR: [
          { firmOrganizationId: { in: firmIds } },
          { members: { some: { userId: user.id } } },
        ],
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, firmOrganizationId: true },
    });
    console.log("\nClient companies you can bookkeep:");
    for (const c of clients) {
      console.log(`  - ${c.name} (${c.id})`);
    }
    const preferred =
      clients.find((c) => c.name.toLowerCase() === "lette") ??
      clients.find((c) => c.slug.toLowerCase().includes("lette")) ??
      clients[0];
    if (!preferred) {
      throw new Error("No CLIENT company under your firm. Add a client in My Business first.");
    }
    targetOrgId = preferred.id;
  }

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: targetOrgId },
    select: { id: true, name: true, slug: true, kind: true },
  });

  console.log(`\nUsing client org: ${org.name} (${org.id})`);

  const bank1Name = `${MARKER} RBC Chequing`;
  const bank2Name = `${MARKER} TD Business`;

  let bank1 = await prisma.bankAccount.findFirst({
    where: { organizationId: org.id, name: bank1Name },
  });
  let bank2 = await prisma.bankAccount.findFirst({
    where: { organizationId: org.id, name: bank2Name },
  });

  if (!bank1) {
    bank1 = await prisma.bankAccount.create({
      data: { organizationId: org.id, name: bank1Name, type: "BANK" },
    });
  }
  if (!bank2) {
    bank2 = await prisma.bankAccount.create({
      data: { organizationId: org.id, name: bank2Name, type: "BANK" },
    });
  }

  // Clean prior demo rows
  await prisma.savedConversion.deleteMany({
    where: { name: { startsWith: MARKER }, folder: { organizationId: org.id } },
  });
  await prisma.transaction.deleteMany({
    where: { organizationId: org.id, description: { contains: MARKER } },
  });

  const csv1 = readFileSync(
    resolve(__dirname, "../samples/demo-nov-2026-bank-1-rbc.csv"),
    "utf8",
  );
  const csv2 = readFileSync(
    resolve(__dirname, "../samples/demo-nov-2026-bank-2-td.csv"),
    "utf8",
  );

  function parseDemoCsv(text: string, fileName: string) {
    const matrix = parseCsvText(text, fileName);
    const lower = matrix.headers.map((h) => h.trim().toLowerCase());
    const dateIdx = lower.findIndex((h) => h === "date");
    const descIdx = lower.findIndex((h) => h.includes("description") || h === "memo");
    const debitIdx = lower.findIndex((h) => h === "debit");
    const creditIdx = lower.findIndex((h) => h === "credit");
    if (dateIdx < 0 || descIdx < 0 || debitIdx < 0 || creditIdx < 0) {
      const mapping = guessMapping(matrix);
      const { rows, errors } = mapRowsToTransactions(matrix, mapping, "YYYY-MM-DD");
      if (errors.length) console.warn(`Parse warnings (${fileName}):`, errors);
      if (!rows.length) throw new Error(`No rows parsed from ${fileName}`);
      return rows;
    }
    const rows: { date: Date; description: string; moneyIn: number; moneyOut: number }[] = [];
    for (const row of matrix.rows) {
      const dateRaw = row[dateIdx]?.trim();
      const date = new Date(`${dateRaw}T12:00:00.000Z`);
      if (Number.isNaN(date.getTime())) continue;
      const debit = Number(String(row[debitIdx] ?? "").replace(/[$,]/g, "")) || 0;
      const credit = Number(String(row[creditIdx] ?? "").replace(/[$,]/g, "")) || 0;
      rows.push({
        date,
        description: row[descIdx]?.trim() || "Transaction",
        moneyIn: credit,
        moneyOut: debit,
      });
    }
    if (!rows.length) throw new Error(`No rows parsed from ${fileName}`);
    return rows;
  }

  function defaultCategory(description: string): { number: string; name: string } {
    const d = description.toUpperCase();
    if (/CLIENT|PAYMENT|DEPOSIT|SHOPIFY|CONSULTING|PAYOUT|INV-/.test(d)) {
      return { number: "4000", name: "Sales" };
    }
    if (/RENT/.test(d)) return { number: "5300", name: "Rent Expense" };
    if (/STAPLES|SUPPLIES|AWS|INTERNET|ROGERS/.test(d)) {
      return { number: "5200", name: "Office Expenses" };
    }
    if (/FEE|BANK/.test(d)) return { number: "5400", name: "Bank Charges" };
    return { number: "5200", name: "Office Expenses" };
  }

  const parsed1 = parseDemoCsv(csv1, "demo-nov-2026-bank-1-rbc.csv");
  const parsed2 = parseDemoCsv(csv2, "demo-nov-2026-bank-2-td.csv");

  async function importToBank(
    bankId: string,
    parsed: { date: Date; description: string; moneyIn: number; moneyOut: number }[],
    label: string,
  ) {
    const ids: string[] = [];
    for (const row of parsed) {
      const cat = defaultCategory(row.description);
      const tx = await prisma.transaction.create({
        data: {
          organizationId: org.id,
          bankAccountId: bankId,
          date: row.date,
          description: `${row.description} ${MARKER}`,
          moneyIn: row.moneyIn,
          moneyOut: row.moneyOut,
          accountNumber: cat.number,
          accountName: cat.name,
          taxCodes: [],
          provinceTaxCodes: [],
          taxMode: "INCLUSIVE",
        },
      });
      ids.push(tx.id);
    }
    console.log(`  Imported ${ids.length} tx → ${label}`);
    return ids;
  }

  console.log("\nImporting demo CSVs…");
  await importToBank(bank1.id, parsed1, bank1Name);
  await importToBank(bank2.id, parsed2, bank2Name);

  async function snapshotForBank(bankId: string) {
    const transactions = await prisma.transaction.findMany({
      where: { organizationId: org.id, bankAccountId: bankId, description: { contains: MARKER } },
      orderBy: { date: "asc" },
    });
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      organizationId: org.id,
      organizationName: org.name,
      bankAccountId: bankId,
      transactionCount: transactions.length,
      transactions: transactions.map((tx) => ({
        id: tx.id,
        bankAccountId: tx.bankAccountId,
        date: tx.date.toISOString().slice(0, 10),
        description: tx.description,
        moneyIn: Number(tx.moneyIn),
        moneyOut: Number(tx.moneyOut),
        accountNumber: tx.accountNumber,
        accountName: tx.accountName,
        province: tx.province,
        taxCodes: tx.taxCodes,
        provinceTaxCodes: tx.provinceTaxCodes,
        taxMode: tx.taxMode,
        notes: tx.notes,
        transferMatchId: tx.transferMatchId,
      })),
      settings: { rules: [], taxCodes: [], accounts: [] },
    };
  }

  let folderA = await prisma.folder.findFirst({
    where: { organizationId: org.id, name: FOLDER_A },
  });
  let folderB = await prisma.folder.findFirst({
    where: { organizationId: org.id, name: FOLDER_B },
  });
  if (!folderA) {
    folderA = await prisma.folder.create({ data: { organizationId: org.id, name: FOLDER_A } });
  }
  if (!folderB) {
    folderB = await prisma.folder.create({ data: { organizationId: org.id, name: FOLDER_B } });
  }

  await prisma.savedConversion.create({
    data: { folderId: folderA.id, name: SAVE_A, snapshot: await snapshotForBank(bank1.id) },
  });
  await prisma.savedConversion.create({
    data: { folderId: folderB.id, name: SAVE_B, snapshot: await snapshotForBank(bank2.id) },
  });

  console.log(`\nSaved conversions:\n  - "${SAVE_A}" in "${FOLDER_A}"\n  - "${SAVE_B}" in "${FOLDER_B}"`);

  // Simulate “saved to folders, workspace cleared” — only snapshots count for unique demo txs if we delete live
  await prisma.transaction.deleteMany({
    where: { organizationId: org.id, description: { contains: MARKER } },
  });

  const demoLive = await prisma.transaction.count({
    where: { organizationId: org.id, description: { contains: MARKER } },
  });
  console.log(`\nLive demo txs after clear: ${demoLive} (expect 0)`);

  const loaded = await loadTransactionsForGeneralEntries(prisma, org.id);
  const demoLoaded = loaded.filter((t) => t.description.includes(MARKER));

  console.log(`\nloadTransactionsForGeneralEntries:`);
  console.log(`  Total org txs in GE pool: ${loaded.length}`);
  console.log(`  Demo MARKER txs from folders: ${demoLoaded.length}`);

  for (const t of demoLoaded) {
    console.log(
      `    ${t.date.toISOString().slice(0, 10)} | ${t.bankName} | in=${t.moneyIn.toFixed(2)} out=${t.moneyOut.toFixed(2)} | ${t.description.replace(` ${MARKER}`, "")}`,
    );
  }

  const expectedDemo = parsed1.length + parsed2.length;
  if (demoLoaded.length !== expectedDemo) {
    throw new Error(`Expected ${expectedDemo} demo txs from 2 folders, got ${demoLoaded.length}`);
  }

  const demoOut = demoLoaded.reduce((s, t) => s + t.moneyOut, 0);
  const demoIn = demoLoaded.reduce((s, t) => s + t.moneyIn, 0);
  if (demoOut < 1) {
    throw new Error("Demo debits did not parse (moneyOut all zero) — check CSV import mapping.");
  }
  console.log(`  Demo totals: money in $${demoIn.toFixed(2)}, money out $${demoOut.toFixed(2)}`);

  const taxCodes = await prisma.taxCode.findMany({ where: { organizationId: org.id } });
  const rateMap = new Map(taxCodes.map((t) => [t.code, Number(t.rate)]));

  const entries = generateAutomaticEntries(loaded, {
    periodType: "CUSTOM",
    taxRateByCode: rateMap,
    customStart: parseGeCustomDateStart("2026-11-01"),
    customEnd: parseGeCustomDateEnd("2026-11-30"),
    inputTaxAccount: null,
    outputTaxAccount: null,
  });

  const demoInPeriod = demoLoaded.filter((t) => {
    const ms = t.date.getTime();
    return ms >= parseGeCustomDateStart("2026-11-01")!.getTime() && ms <= parseGeCustomDateEnd("2026-11-30")!.getTime();
  });

  console.log(`\nGeneral Entries (Nov 2026 custom): ${entries.length} automatic line(s)`);
  console.log(`  Demo txs in period: ${demoInPeriod.length}`);
  if (entries.length < 1) {
    throw new Error("No GE lines — demo txs may be missing account categories.");
  }

  const folders = await prisma.folder.findMany({
    where: { organizationId: org.id, name: { contains: MARKER } },
    include: { conversions: { where: { name: { startsWith: MARKER } } } },
  });

  console.log("\nFolders in app (Favorites / Folders tab):");
  for (const f of folders) {
    console.log(`  - ${f.name}: ${f.conversions.map((s) => s.name).join(", ")}`);
  }

  console.log("\n✓ PASS for", EMAIL);
  console.log("\nIn the UI: open General Entries → Period Custom → 2026-11-01 to 2026-11-30 → Generate.");
  console.log("Demo data is tagged", MARKER, "— safe to delete folders/saves/banks when done.\n");
}

main()
  .catch((e) => {
    console.error("\n✗ FAIL:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
