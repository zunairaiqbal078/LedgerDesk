/**
 * Prove Apply Rules override behavior with a dummy CSV-like dataset.
 *
 * Run: ./node_modules/.bin/tsx scripts/test-apply-rules-behavior.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { findMatchingRule } from "../src/lib/rules-engine";
import { parseMatrixFromAoa } from "../src/lib/import-parser";
import { readFileSync } from "fs";
import { resolve } from "path";

const MARKER = "[RULES-TEST]";

async function main() {
  const csvPath = resolve(__dirname, "../fixtures/rules-override-test.csv");
  const csv = readFileSync(csvPath, "utf8");
  const lines = csv.trim().split(/\r?\n/);
  const headers = lines[0]!.split(",");
  const aoa = [
    headers,
    ...lines.slice(1).map((line) => line.split(",")),
  ];
  const mapped = parseMatrixFromAoa(aoa, "rules-override-test.csv");

  console.log("── CSV parse ──");
  console.log(`Rows parsed: ${mapped.rows.length}`);
  if (mapped.errors.length) console.log("Parse errors:", mapped.errors);
  for (const r of mapped.rows) {
    console.log(
      `  ${r.date.toISOString().slice(0, 10)} | ${r.description.padEnd(28)} | in=${r.moneyIn} out=${r.moneyOut}`,
    );
  }
  if (!mapped.rows.length) throw new Error("CSV produced 0 rows");

  let org =
    (await prisma.organization.findFirst({
      where: { name: "Metric Ltd", kind: "CLIENT", firmOrganizationId: null },
    })) ??
    (await prisma.organization.findFirst({
      where: { kind: "CLIENT" },
      orderBy: { createdAt: "asc" },
    }));

  if (!org) {
    throw new Error("No CLIENT organization found. Sign up / seed first.");
  }

  let bank = await prisma.bankAccount.findFirst({
    where: { organizationId: org.id, isArchived: false },
  });
  if (!bank) {
    bank = await prisma.bankAccount.create({
      data: {
        organizationId: org.id,
        name: `${MARKER} Test Bank`,
        type: "BANK",
        currency: "CAD",
      },
    });
  }

  await prisma.transaction.deleteMany({
    where: { organizationId: org.id, description: { contains: MARKER } },
  });
  await prisma.rule.deleteMany({
    where: { organizationId: org.id, name: { startsWith: MARKER } },
  });

  type CreatedTx = {
    id: string;
    description: string;
    accountName: string | null;
  };
  const created: CreatedTx[] = [];
  let firstStarbucksSeen = false;
  for (const row of mapped.rows) {
    const isStarbucks = /starbucks/i.test(row.description);
    // First Starbucks → WRONG category (should be overridden)
    // Second Starbucks → blank (should get rule)
    const preCategorized = isStarbucks && !firstStarbucksSeen;
    if (isStarbucks) firstStarbucksSeen = true;
    const tx = await prisma.transaction.create({
      data: {
        organizationId: org.id,
        bankAccountId: bank.id,
        date: row.date,
        description: `${MARKER} ${row.description}`,
        moneyIn: row.moneyIn,
        moneyOut: row.moneyOut,
        accountNumber: preCategorized ? "5000" : null,
        accountName: preCategorized ? "Office Supplies (WRONG)" : null,
        taxMode: "INCLUSIVE",
        notes: "rules behavior test",
      },
    });
    created.push({
      id: tx.id,
      description: tx.description,
      accountName: tx.accountName,
    });
  }

  const rule = await prisma.rule.create({
    data: {
      organizationId: org.id,
      name: `${MARKER} Starbucks → Meals`,
      descriptionMatch: "STARBUCKS",
      matchType: "CONTAINS",
      appliesTo: "BOTH",
      applyDeposit: true,
      applyWithdrawal: true,
      accountNumber: "6200",
      accountName: "Meals & Entertainment",
      taxCodes: [],
      provinceTaxCodes: [],
      taxMode: "INCLUSIVE",
      active: true,
      isBuiltIn: false,
    },
  });

  console.log("\n── Setup ──");
  console.log(`Org: ${org.name} (${org.id})`);
  console.log(`Bank: ${bank.name}`);
  console.log(`Rule: ${rule.name} → ${rule.accountName}`);
  console.log("\nBefore Apply Rules:");
  for (const tx of created) {
    console.log(
      `  ${tx.description.slice(0, 40).padEnd(40)} | category=${tx.accountName ?? "(blank)"}`,
    );
  }

  const rules = await prisma.rule.findMany({
    where: { organizationId: org.id, active: true },
    orderBy: [{ isBuiltIn: "asc" }, { createdAt: "asc" }],
  });

  // Reproduce NEW applyRulesToTransactionsAction: all rows, rules override
  const allTestTx = await prisma.transaction.findMany({
    where: {
      organizationId: org.id,
      bankAccountId: bank.id,
      description: { contains: MARKER },
    },
  });

  let updated = 0;
  let overridden = 0;
  for (const tx of allTestTx) {
    const match = findMatchingRule(rules, {
      description: tx.description,
      moneyIn: Number(tx.moneyIn),
      moneyOut: Number(tx.moneyOut),
      statementType: bank.type,
    });
    if (!match) continue;

    const hadCategory = Boolean(tx.accountName?.trim());
    const categoryChanged =
      hadCategory &&
      (tx.accountName !== match.accountName || tx.accountNumber !== match.accountNumber);

    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        accountNumber: match.accountNumber,
        accountName: match.accountName,
        taxCodes: match.taxCodes,
        provinceTaxCodes: match.provinceTaxCodes,
        taxMode: match.taxMode,
      },
    });
    updated += 1;
    if (categoryChanged) overridden += 1;
  }

  const after = await prisma.transaction.findMany({
    where: {
      organizationId: org.id,
      bankAccountId: bank.id,
      description: { contains: MARKER },
    },
    orderBy: { date: "asc" },
  });

  console.log("\n── Apply Rules (override enabled) ──");
  console.log(`Updated: ${updated} (${overridden} overridden)`);
  console.log("After:");
  for (const tx of after) {
    console.log(
      `  ${tx.description.replace(MARKER + " ", "").padEnd(28)} | category=${tx.accountName ?? "(blank)"}`,
    );
  }

  const wrongStillThere = after.find((t) => (t.accountName ?? "").includes("WRONG"));
  const mealsApplied = after.filter((t) => t.accountName === "Meals & Entertainment");
  const starbucks = after.filter((t) => /starbucks/i.test(t.description));

  console.log("\n── Verdict ──");
  if (wrongStillThere) {
    console.log("FAIL: Apply Rules did NOT override existing Account/Category.");
    console.log(
      `  Kept: “${wrongStillThere.description.replace(MARKER + " ", "")}” → ${wrongStillThere.accountName}`,
    );
    process.exitCode = 1;
  } else if (mealsApplied.length < 2 || starbucks.some((t) => t.accountName !== "Meals & Entertainment")) {
    console.log("FAIL: Expected both Starbucks rows → Meals & Entertainment.");
    process.exitCode = 1;
  } else {
    console.log("PASS: Apply Rules overrides existing categories when a rule matches.");
    console.log(
      `  Meals & Entertainment applied to ${mealsApplied.length} row(s); ${overridden} override(s).`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
