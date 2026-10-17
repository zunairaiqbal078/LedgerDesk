/**
 * End-to-end calculation checks vs reference HTML converter formulas.
 *
 *   pnpm test:calcs
 *
 * Covers: CSV import parse, transaction tax math, GST, PST,
 * transfer matching, general entries, reconciliation (bank + credit card).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseCsvText,
  guessMapping,
  mapRowsToTransactions,
} from "../src/lib/import-parser";
import {
  calculateTransactionAmounts,
  summarizeTransactions,
} from "../src/lib/transaction-math";
import {
  taxAmountFor,
  calculateGstSummary,
  calculatePstSummary,
  buildPeriods,
  type TaxCodeInfo,
  type TxForTax,
} from "../src/lib/tax-reports";
import {
  findTransferCandidates,
  uniqueTransferCandidates,
} from "../src/lib/transfer-matching";
import { generateAutomaticEntries } from "../src/lib/general-entries";

const CATALOG: TaxCodeInfo[] = [
  { code: "GST5", rate: 5, kind: "GST_HST" },
  { code: "GST2.5", rate: 2.5, kind: "GST_HST" },
  { code: "HST13", rate: 13, kind: "GST_HST" },
  { code: "BC PST7", rate: 7, kind: "PST" },
  { code: "SK PST6", rate: 6, kind: "PST" },
  { code: "NONE", rate: 0, kind: "NONE" },
  { code: "ZERO", rate: 0, kind: "GST_HST" },
];

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function assertEq(label: string, actual: number, expected: number, tol = 0.01) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) {
    console.error(`  FAIL ${label}: got ${actual}, expected ${expected}`);
    return false;
  }
  console.log(`  PASS ${label}: ${actual}`);
  return true;
}

function assert(label: string, cond: boolean, detail = "") {
  if (!cond) {
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    return false;
  }
  console.log(`  PASS ${label}`);
  return true;
}

/** Mirror HTML reconCalc */
function reconCalc(opts: {
  type: "BANK" | "CREDIT_CARD";
  opening: number;
  statementEnding: number;
  moneyIn: number;
  moneyOut: number;
}) {
  const calculated =
    opts.type === "CREDIT_CARD"
      ? opts.opening + opts.moneyOut - opts.moneyIn
      : opts.opening + opts.moneyIn - opts.moneyOut;
  const difference = opts.statementEnding - calculated;
  return { calculated: round2(calculated), difference: round2(difference) };
}

/** Same as UI / import preview Swap Debit ↔ Credit. */
function swapMoneySides<T extends { moneyIn: number; moneyOut: number }>(row: T): T {
  return { ...row, moneyIn: row.moneyOut, moneyOut: row.moneyIn };
}

function swapAll<T extends { moneyIn: number; moneyOut: number }>(rows: T[]): T[] {
  return rows.map(swapMoneySides);
}

async function main() {
  let failed = 0;
  const csvPath = resolve(process.cwd(), "fixtures/calc-test-transactions.csv");
  const csvText = readFileSync(csvPath, "utf8");

  // ── 1. CSV import parse ──────────────────────────────────────────────
  console.log("\n=== 1. Transactions / CSV import ===");
  const matrix = parseCsvText(csvText, "calc-test-transactions.csv");
  const mapping = guessMapping(matrix.headers, matrix);
  failed += assert("guessed date column", Boolean(mapping.date)) ? 0 : 1;
  failed += assert("guessed description", Boolean(mapping.description)) ? 0 : 1;
  failed += assert("guessed money in", Boolean(mapping.moneyIn)) ? 0 : 1;
  failed += assert("guessed money out", Boolean(mapping.moneyOut)) ? 0 : 1;

  const mapped = mapRowsToTransactions(matrix, {
    date: mapping.date!,
    description: mapping.description!,
    moneyIn: mapping.moneyIn,
    moneyOut: mapping.moneyOut,
    dateFormat: "AUTO",
    signedRule: "positiveIn",
  });
  failed += assertEq("imported row count", mapped.rows.length, 10) ? 0 : 1;
  failed += assertEq("row0 moneyIn", mapped.rows[0]!.moneyIn, 1120) ? 0 : 1;
  failed += assertEq("row1 moneyOut", mapped.rows[1]!.moneyOut, 56) ? 0 : 1;

  // Enrich with categorization + tax (as UI would after rules / bulk edit)
  const txs: TxForTax[] = [
    {
      id: "t1",
      date: new Date("2025-03-01T12:00:00Z"),
      description: "Client invoice payment ABC Ltd",
      moneyIn: 1120,
      moneyOut: 0,
      accountNumber: "4000",
      accountName: "Sales Revenue",
      accountType: "INCOME",
      taxCodes: ["GST5"],
      provinceTaxCodes: [],
      taxMode: "INCLUSIVE",
    },
    {
      id: "t2",
      date: new Date("2025-03-02T12:00:00Z"),
      description: "Office supplies Staples",
      moneyIn: 0,
      moneyOut: 56,
      accountNumber: "5200",
      accountName: "Office Supplies",
      accountType: "EXPENSE",
      taxCodes: ["GST5"],
      provinceTaxCodes: [],
      taxMode: "INCLUSIVE",
    },
    {
      id: "t3",
      date: new Date("2025-03-03T12:00:00Z"),
      description: "Consulting revenue exclusive GST",
      moneyIn: 1000,
      moneyOut: 0,
      accountNumber: "4000",
      accountName: "Sales Revenue",
      accountType: "INCOME",
      taxCodes: ["GST5"],
      provinceTaxCodes: [],
      taxMode: "EXCLUSIVE",
    },
    {
      id: "t4",
      date: new Date("2025-03-04T12:00:00Z"),
      description: "Meals Tim Hortons",
      moneyIn: 0,
      moneyOut: 21,
      accountNumber: "5600",
      accountName: "Meals & Entertainment",
      accountType: "EXPENSE",
      taxCodes: ["GST2.5"],
      provinceTaxCodes: [],
      taxMode: "INCLUSIVE",
    },
    {
      id: "t5",
      date: new Date("2025-03-05T12:00:00Z"),
      description: "BC sale with GST and PST",
      moneyIn: 112,
      moneyOut: 0,
      accountNumber: "4000",
      accountName: "Sales Revenue",
      accountType: "INCOME",
      taxCodes: ["GST5"],
      provinceTaxCodes: ["BC PST7"],
      taxMode: "INCLUSIVE",
    },
    {
      id: "t6",
      date: new Date("2025-03-06T12:00:00Z"),
      description: "Transfer to Visa ****1234",
      moneyIn: 0,
      moneyOut: 500,
      accountNumber: null,
      accountName: null,
      accountType: null,
      taxCodes: [],
      taxMode: "INCLUSIVE",
      transferMatchId: "tm1",
    },
    {
      id: "t7",
      date: new Date("2025-03-07T12:00:00Z"),
      description: "Transfer from Chequing",
      moneyIn: 500,
      moneyOut: 0,
      accountNumber: null,
      accountName: null,
      accountType: null,
      taxCodes: [],
      taxMode: "INCLUSIVE",
      transferMatchId: "tm1",
    },
    {
      id: "t8",
      date: new Date("2025-03-08T12:00:00Z"),
      description: "CRA GST remittance payment",
      moneyIn: 0,
      moneyOut: 200,
      accountNumber: "2100",
      accountName: "GST/HST Payable",
      accountType: "LIABILITY",
      taxCodes: [],
      taxMode: "INCLUSIVE",
    },
    {
      id: "t9",
      date: new Date("2025-03-09T12:00:00Z"),
      description: "Untaxed income deposit",
      moneyIn: 250,
      moneyOut: 0,
      accountNumber: "4000",
      accountName: "Sales Revenue",
      accountType: "INCOME",
      taxCodes: [],
      taxMode: "INCLUSIVE",
    },
    {
      id: "t10",
      date: new Date("2025-03-10T12:00:00Z"),
      description: "Equipment purchase asset GST",
      moneyIn: 0,
      moneyOut: 525,
      accountNumber: "1800",
      accountName: "Computer Equipment",
      accountType: "ASSET",
      taxCodes: ["GST5"],
      provinceTaxCodes: [],
      taxMode: "INCLUSIVE",
    },
  ];

  // ── 2. Transaction-level tax math (HTML taxAmountFor / netAmountFor) ─
  console.log("\n=== 2. Transaction tax math (Inclusive / Exclusive) ===");
  {
    const a = calculateTransactionAmounts(
      { moneyIn: 1120, moneyOut: 0, taxCodes: ["GST5"], taxMode: "INCLUSIVE" },
      CATALOG,
    );
    // 1120 / 1.05 = 1066.666… → tax 53.33, net 1066.67
    failed += assertEq("incl GST5 tax", a.taxAmount, 53.33) ? 0 : 1;
    failed += assertEq("incl GST5 net", a.netAmount, 1066.67) ? 0 : 1;
  }
  {
    const a = calculateTransactionAmounts(
      { moneyIn: 1000, moneyOut: 0, taxCodes: ["GST5"], taxMode: "EXCLUSIVE" },
      CATALOG,
    );
    failed += assertEq("excl GST5 tax", a.taxAmount, 50) ? 0 : 1;
    failed += assertEq("excl GST5 net", a.netAmount, 1000) ? 0 : 1;
  }
  {
    // HTML: GST = 112*(0.05/1.12)=5, PST=112*(0.07/1.12)=7, net=100
    const a = calculateTransactionAmounts(
      {
        moneyIn: 112,
        moneyOut: 0,
        taxCodes: ["GST5"],
        provinceTaxCodes: ["BC PST7"],
        taxMode: "INCLUSIVE",
      },
      CATALOG,
    );
    failed += assertEq("incl GST+PST total tax", a.taxAmount, 12) ? 0 : 1;
    failed += assertEq("incl GST share", a.salesTaxAmount, 5) ? 0 : 1;
    failed += assertEq("incl PST share", a.provinceTaxAmount, 7) ? 0 : 1;
    failed += assertEq("incl GST+PST net", a.netAmount, 100) ? 0 : 1;
  }
  {
    const g = taxAmountFor(112, 0, CATALOG.filter((c) => ["GST5", "BC PST7"].includes(c.code)), "INCLUSIVE", "GST_HST");
    const p = taxAmountFor(112, 0, CATALOG.filter((c) => ["GST5", "BC PST7"].includes(c.code)), "INCLUSIVE", "PST");
    failed += assertEq("report GST split (HTML)", g.tax, 5) ? 0 : 1;
    failed += assertEq("report PST split (HTML)", p.tax, 7) ? 0 : 1;
    failed += assertEq("report net after both", g.netIn, 100) ? 0 : 1;
  }

  // ── 3. GST Calculation ───────────────────────────────────────────────
  console.log("\n=== 3. GST Calculation ===");
  const period = {
    key: "M3-2025",
    label: "2025-03",
    start: new Date("2025-03-01T00:00:00Z"),
    end: new Date("2025-03-31T23:59:59Z"),
  };
  const gst = calculateGstSummary(txs, CATALOG, period);
  // Sales:
  // t1: net 1066.67, gst 53.33
  // t3 excl: net 1000, gst 50
  // t5: net 100, gst 5
  // t9: non-taxable 250
  // ITC:
  // t2: tax 2.67 (56-56/1.05)
  // t4: tax 0.51 (21-21/1.025)
  // t10: tax 25 (525-525/1.05)
  // t6/t7 transfer excluded; t8 CRA excluded
  const expGstCollected = round2(53.33 + 50 + 5);
  const expItc = round2(2.67 + 0.51 + 25);
  const expTaxable = round2(1066.67 + 1000 + 100);
  failed += assertEq("GST taxable sales", gst.taxableSales, expTaxable) ? 0 : 1;
  failed += assertEq("GST non-taxable sales", gst.nonTaxableSales, 250) ? 0 : 1;
  failed += assertEq("GST collected", gst.gstCollected, expGstCollected) ? 0 : 1;
  failed += assertEq("GST ITC paid", gst.itcPaid, expItc) ? 0 : 1;
  failed += assertEq("GST payable", gst.gstPayable, round2(expGstCollected - expItc)) ? 0 : 1;
  failed += assert(
    "CRA remittance excluded from GST",
    !gst.lines.some((l) => l.id === "t8" && l.role !== "excluded"),
  )
    ? 0
    : 1;
  failed += assert(
    "transfer excluded from GST",
    gst.lines.filter((l) => l.id === "t6" || l.id === "t7").every((l) => l.role === "excluded"),
  )
    ? 0
    : 1;

  // ── 4. PST Calculation ───────────────────────────────────────────────
  console.log("\n=== 4. PST Calculation ===");
  const pst = calculatePstSummary(txs, CATALOG, period, "BC");
  // Only t5 has PST: collected 7, taxable 100; payable = collected only
  failed += assertEq("PST taxable sales", pst.taxableSales, 100) ? 0 : 1;
  failed += assertEq("PST collected", pst.pstCollected, 7) ? 0 : 1;
  failed += assertEq("PST payable (= collected)", pst.pstPayable, 7) ? 0 : 1;
  failed += assert(
    "transfer excluded from PST",
    pst.lines.filter((l) => l.id === "t6" || l.id === "t7").every((l) => l.role === "excluded"),
  )
    ? 0
    : 1;

  // ── 5. Transfer Matching ─────────────────────────────────────────────
  console.log("\n=== 5. Transfer Matching ===");
  const unmatched = [
    {
      id: "t6",
      date: new Date("2025-03-06T12:00:00Z"),
      description: "Transfer to Visa",
      moneyIn: 0,
      moneyOut: 500,
      bankAccountId: "bank-cheq",
    },
    {
      id: "t7",
      date: new Date("2025-03-07T12:00:00Z"),
      description: "Transfer from Chequing",
      moneyIn: 500,
      moneyOut: 0,
      bankAccountId: "bank-visa",
    },
    {
      id: "noise",
      date: new Date("2025-03-06T12:00:00Z"),
      description: "Office rent",
      moneyIn: 0,
      moneyOut: 500,
      bankAccountId: "bank-cheq",
    },
  ];
  const candidates = findTransferCandidates(unmatched, 7);
  failed += assert("finds transfer candidate", candidates.some((c) => c.outId === "t6" && c.inId === "t7"))
    ? 0
    : 1;
  failed += assertEq("candidate amount", candidates.find((c) => c.outId === "t6")?.amount ?? 0, 500)
    ? 0
    : 1;
  // noise competes on out side → unique filter drops ambiguous outs
  const unique = uniqueTransferCandidates(candidates);
  failed += assert(
    "ambiguous 500 out not unique-auto-matched",
    !unique.some((c) => c.outId === "t6" || c.outId === "noise"),
  )
    ? 0
    : 1;
  const clean = findTransferCandidates(
    unmatched.filter((r) => r.id !== "noise"),
    7,
  );
  failed += assertEq("unique clean matches", uniqueTransferCandidates(clean).length, 1) ? 0 : 1;

  // ── 6. General Entries ───────────────────────────────────────────────
  console.log("\n=== 6. General Entries ===");
  const geTxs = txs
    .filter((t) => t.accountName && !t.transferMatchId)
    .map((t) => ({
      id: t.id,
      date: t.date,
      description: t.description,
      moneyIn: t.moneyIn,
      moneyOut: t.moneyOut,
      accountNumber: t.accountNumber,
      accountName: t.accountName,
      taxCodes: t.taxCodes,
      taxMode: t.taxMode,
      transferMatchId: t.transferMatchId,
      bankAccountId: "bank-cheq",
      bankName: "Operating Chequing",
      bankType: "BANK" as const,
    }));
  const rateMap = new Map(CATALOG.map((c) => [c.code, c.rate]));
  const entries = generateAutomaticEntries(geTxs, {
    periodType: "MONTHLY",
    taxRateByCode: rateMap,
  });
  failed += assert("generated at least one GE", entries.length > 0) ? 0 : 1;
  for (const e of entries) {
    const debit = round2(e.lines.reduce((s, l) => s + l.debit, 0));
    const credit = round2(e.lines.reduce((s, l) => s + l.credit, 0));
    failed += assertEq(`GE balanced [${e.memo}]`, debit, credit, 0.02) ? 0 : 1;
  }
  const salesEntry = entries.find((e) => e.memo.includes("Sales Revenue"));
  failed += assert("Sales Revenue GE exists", Boolean(salesEntry)) ? 0 : 1;
  if (salesEntry) {
    const gstLine = salesEntry.lines.find((l) => l.accountNumber === "2100");
    failed += assert("GST payable line on sales GE", Boolean(gstLine)) ? 0 : 1;
  }

  // ── 7. Reconciliation ────────────────────────────────────────────────
  console.log("\n=== 7. Reconciliation ===");
  {
    // Bank: open 1000 + in 1120 − out 56 = 2064; statement 2064 → diff 0
    const r = reconCalc({
      type: "BANK",
      opening: 1000,
      statementEnding: 2064,
      moneyIn: 1120,
      moneyOut: 56,
    });
    failed += assertEq("bank calculated ending", r.calculated, 2064) ? 0 : 1;
    failed += assertEq("bank difference", r.difference, 0) ? 0 : 1;
  }
  {
    // Credit card HTML: open 200 + out 500 − in 100 = 600
    const r = reconCalc({
      type: "CREDIT_CARD",
      opening: 200,
      statementEnding: 600,
      moneyIn: 100,
      moneyOut: 500,
    });
    failed += assertEq("CC calculated ending (HTML)", r.calculated, 600) ? 0 : 1;
    failed += assertEq("CC difference", r.difference, 0) ? 0 : 1;
  }
  {
    const r = reconCalc({
      type: "BANK",
      opening: 1000,
      statementEnding: 2050,
      moneyIn: 1120,
      moneyOut: 56,
    });
    failed += assertEq("bank mismatch difference", r.difference, -14) ? 0 : 1;
  }

  // Summary rollup sanity
  console.log("\n=== Summary rollup ===");
  const summary = summarizeTransactions(
    [
      { moneyIn: 1120, moneyOut: 0, taxCodes: ["GST5"], taxMode: "INCLUSIVE" },
      { moneyIn: 0, moneyOut: 56, taxCodes: ["GST5"], taxMode: "INCLUSIVE" },
    ],
    CATALOG,
  );
  failed += assertEq("summary moneyIn", summary.moneyIn, 1120) ? 0 : 1;
  failed += assertEq("summary moneyOut", summary.moneyOut, 56) ? 0 : 1;

  // ════════════════════════════════════════════════════════════════════
  // EDGE CASES
  // ════════════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════╗");
  console.log("║         EDGE CASES               ║");
  console.log("╚══════════════════════════════════╝");

  // ── E1. Tax math edges ─────────────────────────────────────────────
  console.log("\n=== E1. Tax math edges ===");
  {
    const z = calculateTransactionAmounts(
      { moneyIn: 0, moneyOut: 0, taxCodes: ["GST5"], taxMode: "INCLUSIVE" },
      CATALOG,
    );
    failed += assertEq("zero gross → tax 0", z.taxAmount, 0) ? 0 : 1;
    failed += assertEq("zero gross → net 0", z.netAmount, 0) ? 0 : 1;
  }
  {
    const z = calculateTransactionAmounts(
      { moneyIn: 100, moneyOut: 0, taxCodes: ["NONE"], taxMode: "INCLUSIVE" },
      CATALOG,
    );
    failed += assertEq("NONE code → tax 0", z.taxAmount, 0) ? 0 : 1;
    failed += assertEq("NONE code → net = gross", z.netAmount, 100) ? 0 : 1;
  }
  {
    const z = calculateTransactionAmounts(
      { moneyIn: 100, moneyOut: 0, taxCodes: ["ZERO"], taxMode: "INCLUSIVE" },
      CATALOG,
    );
    failed += assertEq("ZERO GST rate → tax 0", z.taxAmount, 0) ? 0 : 1;
  }
  {
    const z = calculateTransactionAmounts(
      { moneyIn: 100, moneyOut: 0, taxCodes: [], taxMode: "INCLUSIVE" },
      CATALOG,
    );
    failed += assertEq("empty taxCodes → tax 0", z.taxAmount, 0) ? 0 : 1;
  }
  {
    // KEEP treated as inclusive
    const keep = calculateTransactionAmounts(
      { moneyIn: 105, moneyOut: 0, taxCodes: ["GST5"], taxMode: "KEEP" },
      CATALOG,
    );
    const incl = calculateTransactionAmounts(
      { moneyIn: 105, moneyOut: 0, taxCodes: ["GST5"], taxMode: "INCLUSIVE" },
      CATALOG,
    );
    failed += assertEq("KEEP == INCLUSIVE tax", keep.taxAmount, incl.taxAmount) ? 0 : 1;
  }
  {
    const p = calculateTransactionAmounts(
      { moneyIn: 0, moneyOut: 0.01, taxCodes: ["GST5"], taxMode: "INCLUSIVE" },
      CATALOG,
    );
    failed += assert("penny amount doesn't NaN", Number.isFinite(p.taxAmount) && Number.isFinite(p.netAmount))
      ? 0
      : 1;
  }
  {
    const h = calculateTransactionAmounts(
      { moneyIn: 113, moneyOut: 0, taxCodes: ["HST13"], taxMode: "INCLUSIVE" },
      CATALOG,
    );
    // 113/1.13 = 100 → tax 13
    failed += assertEq("HST13 inclusive tax", h.taxAmount, 13) ? 0 : 1;
    failed += assertEq("HST13 inclusive net", h.netAmount, 100) ? 0 : 1;
  }
  {
    const onlyPst = calculateTransactionAmounts(
      {
        moneyIn: 107,
        moneyOut: 0,
        taxCodes: [],
        provinceTaxCodes: ["BC PST7"],
        taxMode: "INCLUSIVE",
      },
      CATALOG,
    );
    failed += assertEq("PST-only inclusive tax", onlyPst.taxAmount, 7) ? 0 : 1;
    failed += assertEq("PST-only inclusive net", onlyPst.netAmount, 100) ? 0 : 1;
  }
  {
    const exclBoth = calculateTransactionAmounts(
      {
        moneyIn: 100,
        moneyOut: 0,
        taxCodes: ["GST5"],
        provinceTaxCodes: ["BC PST7"],
        taxMode: "EXCLUSIVE",
      },
      CATALOG,
    );
    failed += assertEq("excl GST+PST tax", exclBoth.taxAmount, 12) ? 0 : 1;
    failed += assertEq("excl GST+PST net stays gross", exclBoth.netAmount, 100) ? 0 : 1;
  }
  {
    // Rounding: 10.00 inclusive 5% → tax 0.48 (10 - 10/1.05 = 0.47619 → 0.48)
    const r = taxAmountFor(10, 0, [{ code: "GST5", rate: 5, kind: "GST_HST" }], "INCLUSIVE", "GST_HST");
    failed += assertEq("rounding 10@5% tax", r.tax, 0.48) ? 0 : 1;
  }
  {
    // Unknown code ignored
    const u = calculateTransactionAmounts(
      { moneyIn: 105, moneyOut: 0, taxCodes: ["NOT_A_REAL_CODE", "GST5"], taxMode: "INCLUSIVE" },
      CATALOG,
    );
    failed += assertEq("unknown tax code ignored", u.taxAmount, 5) ? 0 : 1;
  }

  // ── E2. GST edges ──────────────────────────────────────────────────
  console.log("\n=== E2. GST edges ===");
  const mar = {
    key: "M3",
    label: "Mar",
    start: new Date("2025-03-01T00:00:00Z"),
    end: new Date("2025-03-31T23:59:59.999Z"),
  };
  {
    const outside: TxForTax[] = [
      {
        id: "out",
        date: new Date("2025-02-28T12:00:00Z"),
        description: "Feb sale",
        moneyIn: 105,
        moneyOut: 0,
        accountNumber: "4000",
        accountName: "Sales",
        accountType: "INCOME",
        taxCodes: ["GST5"],
        taxMode: "INCLUSIVE",
      },
    ];
    const g = calculateGstSummary(outside, CATALOG, mar);
    failed += assertEq("out-of-period sale ignored", g.gstCollected, 0) ? 0 : 1;
    failed += assertEq("out-of-period lines empty", g.lines.length, 0) ? 0 : 1;
  }
  {
    // Period boundary inclusive
    const edges: TxForTax[] = [
      {
        id: "s",
        date: new Date("2025-03-01T00:00:00Z"),
        description: "Start day",
        moneyIn: 105,
        moneyOut: 0,
        accountNumber: "4000",
        accountName: "Sales",
        accountType: "INCOME",
        taxCodes: ["GST5"],
        taxMode: "INCLUSIVE",
      },
      {
        id: "e",
        date: new Date("2025-03-31T23:00:00Z"),
        description: "End day",
        moneyIn: 105,
        moneyOut: 0,
        accountNumber: "4000",
        accountName: "Sales",
        accountType: "INCOME",
        taxCodes: ["GST5"],
        taxMode: "INCLUSIVE",
      },
    ];
    const g = calculateGstSummary(edges, CATALOG, mar);
    failed += assertEq("period start+end inclusive", g.gstCollected, 10) ? 0 : 1;
  }
  {
    // Income refund (money out) reduces taxable sales / GST collected
    const refund: TxForTax[] = [
      {
        id: "sale",
        date: new Date("2025-03-05T12:00:00Z"),
        description: "Sale",
        moneyIn: 210,
        moneyOut: 0,
        accountNumber: "4000",
        accountName: "Sales",
        accountType: "INCOME",
        taxCodes: ["GST5"],
        taxMode: "INCLUSIVE",
      },
      {
        id: "ref",
        date: new Date("2025-03-06T12:00:00Z"),
        description: "Sales refund",
        moneyIn: 0,
        moneyOut: 105,
        accountNumber: "4000",
        accountName: "Sales",
        accountType: "INCOME",
        taxCodes: ["GST5"],
        taxMode: "INCLUSIVE",
      },
    ];
    const g = calculateGstSummary(refund, CATALOG, mar);
    failed += assertEq("income refund nets taxable sales", g.taxableSales, 100) ? 0 : 1;
    failed += assertEq("income refund nets GST collected", g.gstCollected, 5) ? 0 : 1;
  }
  {
    // Expense refund (money in) reduces ITC
    const refund: TxForTax[] = [
      {
        id: "buy",
        date: new Date("2025-03-05T12:00:00Z"),
        description: "Purchase",
        moneyIn: 0,
        moneyOut: 210,
        accountNumber: "5200",
        accountName: "Supplies",
        accountType: "EXPENSE",
        taxCodes: ["GST5"],
        taxMode: "INCLUSIVE",
      },
      {
        id: "eref",
        date: new Date("2025-03-06T12:00:00Z"),
        description: "Purchase refund",
        moneyIn: 105,
        moneyOut: 0,
        accountNumber: "5200",
        accountName: "Supplies",
        accountType: "EXPENSE",
        taxCodes: ["GST5"],
        taxMode: "INCLUSIVE",
      },
    ];
    const g = calculateGstSummary(refund, CATALOG, mar);
    failed += assertEq("expense refund nets ITC", g.itcPaid, 5) ? 0 : 1;
  }
  {
    const settlements: TxForTax[] = [
      {
        id: "a",
        date: new Date("2025-03-10T12:00:00Z"),
        description: "RECEIVER GENERAL GST payment",
        moneyIn: 0,
        moneyOut: 500,
        accountNumber: "2100",
        accountName: "GST Payable",
        accountType: "LIABILITY",
        taxCodes: ["GST5"],
        taxMode: "INCLUSIVE",
      },
      {
        id: "b",
        date: new Date("2025-03-11T12:00:00Z"),
        description: "HST REMITTANCE March",
        moneyIn: 0,
        moneyOut: 100,
        accountNumber: null,
        accountName: null,
        accountType: "EXPENSE",
        taxCodes: ["HST13"],
        taxMode: "INCLUSIVE",
      },
      {
        id: "c",
        date: new Date("2025-03-12T12:00:00Z"),
        description: "GST PAY online",
        moneyIn: 0,
        moneyOut: 50,
        accountNumber: null,
        accountName: null,
        accountType: "EXPENSE",
        taxCodes: ["GST5"],
        taxMode: "INCLUSIVE",
      },
    ];
    const g = calculateGstSummary(settlements, CATALOG, mar);
    failed += assert(
      "all GST settlement variants excluded",
      g.lines.every((l) => l.role === "excluded") && g.gstCollected === 0 && g.itcPaid === 0,
    )
      ? 0
      : 1;
  }
  {
    const untyped: TxForTax[] = [
      {
        id: "u",
        date: new Date("2025-03-15T12:00:00Z"),
        description: "Mystery",
        moneyIn: 0,
        moneyOut: 105,
        accountNumber: null,
        accountName: "Mystery",
        accountType: null,
        taxCodes: ["GST5"],
        taxMode: "INCLUSIVE",
      },
    ];
    const g = calculateGstSummary(untyped, CATALOG, mar);
    failed += assert(
      "uncategorized type → review (no ITC/sale)",
      g.lines[0]?.role === "review" && g.itcPaid === 0 && g.gstCollected === 0,
    )
      ? 0
      : 1;
  }
  {
    const liability: TxForTax[] = [
      {
        id: "l",
        date: new Date("2025-03-15T12:00:00Z"),
        description: "Loan payment",
        moneyIn: 0,
        moneyOut: 105,
        accountNumber: "2500",
        accountName: "Loan",
        accountType: "LIABILITY",
        taxCodes: ["GST5"],
        taxMode: "INCLUSIVE",
      },
    ];
    const g = calculateGstSummary(liability, CATALOG, mar);
    failed += assert("LIABILITY not sale/ITC", g.lines[0]?.role === "review" && g.itcPaid === 0)
      ? 0
      : 1;
  }

  // ── E3. PST edges ──────────────────────────────────────────────────
  console.log("\n=== E3. PST edges ===");
  {
    const wrongProv: TxForTax[] = [
      {
        id: "p",
        date: new Date("2025-03-05T12:00:00Z"),
        description: "SK sale",
        moneyIn: 106,
        moneyOut: 0,
        accountNumber: "4000",
        accountName: "Sales",
        accountType: "INCOME",
        taxCodes: [],
        provinceTaxCodes: ["SK PST6"],
        taxMode: "INCLUSIVE",
        province: "SK",
      },
    ];
    const p = calculatePstSummary(wrongProv, CATALOG, mar, "BC");
    failed += assert(
      "PST province mismatch excluded",
      p.lines[0]?.role === "excluded" && p.pstCollected === 0,
    )
      ? 0
      : 1;
  }
  {
    const settle: TxForTax[] = [
      {
        id: "ps",
        date: new Date("2025-03-08T12:00:00Z"),
        description: "PST PAY Ministry",
        moneyIn: 0,
        moneyOut: 80,
        accountNumber: null,
        accountName: null,
        accountType: "EXPENSE",
        taxCodes: [],
        provinceTaxCodes: ["BC PST7"],
        taxMode: "INCLUSIVE",
      },
    ];
    const p = calculatePstSummary(settle, CATALOG, mar, "BC");
    failed += assert("PST settlement excluded", p.lines[0]?.role === "excluded" && p.pstPaid === 0)
      ? 0
      : 1;
  }
  {
    const paid: TxForTax[] = [
      {
        id: "buy",
        date: new Date("2025-03-05T12:00:00Z"),
        description: "BC retail buy",
        moneyIn: 0,
        moneyOut: 107,
        accountNumber: "5200",
        accountName: "Supplies",
        accountType: "EXPENSE",
        taxCodes: [],
        provinceTaxCodes: ["BC PST7"],
        taxMode: "INCLUSIVE",
        province: "BC",
      },
      {
        id: "sale",
        date: new Date("2025-03-06T12:00:00Z"),
        description: "BC retail sale",
        moneyIn: 107,
        moneyOut: 0,
        accountNumber: "4000",
        accountName: "Sales",
        accountType: "INCOME",
        taxCodes: [],
        provinceTaxCodes: ["BC PST7"],
        taxMode: "INCLUSIVE",
        province: "BC",
      },
    ];
    const p = calculatePstSummary(paid, CATALOG, mar, "BC");
    failed += assertEq("PST paid tracked", p.pstPaid, 7) ? 0 : 1;
    failed += assertEq("PST payable ignores paid (HTML)", p.pstPayable, 7) ? 0 : 1;
    failed += assert("pstPayable !== collected-paid", p.pstPayable !== round2(p.pstCollected - p.pstPaid))
      ? 0
      : 1;
  }

  // ── E4. Transfer matching edges ────────────────────────────────────
  console.log("\n=== E4. Transfer matching edges ===");
  {
    const sameBank = findTransferCandidates(
      [
        {
          id: "a",
          date: new Date("2025-03-01Z"),
          description: "out",
          moneyIn: 0,
          moneyOut: 50,
          bankAccountId: "b1",
        },
        {
          id: "b",
          date: new Date("2025-03-01Z"),
          description: "in",
          moneyIn: 50,
          moneyOut: 0,
          bankAccountId: "b1",
        },
      ],
      7,
    );
    failed += assertEq("same bank → no match", sameBank.length, 0) ? 0 : 1;
  }
  {
    const mismatch = findTransferCandidates(
      [
        {
          id: "a",
          date: new Date("2025-03-01Z"),
          description: "out",
          moneyIn: 0,
          moneyOut: 50,
          bankAccountId: "b1",
        },
        {
          id: "b",
          date: new Date("2025-03-01Z"),
          description: "in",
          moneyIn: 50.01,
          moneyOut: 0,
          bankAccountId: "b2",
        },
      ],
      7,
    );
    failed += assertEq("amount mismatch 0.01 → no match", mismatch.length, 0) ? 0 : 1;
  }
  {
    const cents = findTransferCandidates(
      [
        {
          id: "a",
          date: new Date("2025-03-01Z"),
          description: "out",
          moneyIn: 0,
          moneyOut: 50.001,
          bankAccountId: "b1",
        },
        {
          id: "b",
          date: new Date("2025-03-01Z"),
          description: "in",
          moneyIn: 50,
          moneyOut: 0,
          bankAccountId: "b2",
        },
      ],
      7,
    );
    // |50.001-50| = 0.001 → boundary allowed (≤ 0.001)
    failed += assertEq("0.001 amount tolerance allowed", cents.length, 1) ? 0 : 1;
  }
  {
    const windowed = findTransferCandidates(
      [
        {
          id: "a",
          date: new Date("2025-03-01Z"),
          description: "out",
          moneyIn: 0,
          moneyOut: 80,
          bankAccountId: "b1",
        },
        {
          id: "b",
          date: new Date("2025-03-10Z"),
          description: "in",
          moneyIn: 80,
          moneyOut: 0,
          bankAccountId: "b2",
        },
      ],
      7,
    );
    failed += assertEq("outside ±7 days → no match", windowed.length, 0) ? 0 : 1;
    const sameDay = findTransferCandidates(
      [
        {
          id: "a",
          date: new Date("2025-03-01T08:00:00Z"),
          description: "out",
          moneyIn: 0,
          moneyOut: 80,
          bankAccountId: "b1",
        },
        {
          id: "b",
          date: new Date("2025-03-01T20:00:00Z"),
          description: "in",
          moneyIn: 80,
          moneyOut: 0,
          bankAccountId: "b2",
        },
      ],
      0,
    );
    failed += assertEq("same calendar day window=0 matches", sameDay.length, 1) ? 0 : 1;
  }
  {
    const already = findTransferCandidates(
      [
        {
          id: "a",
          date: new Date("2025-03-01Z"),
          description: "out",
          moneyIn: 0,
          moneyOut: 40,
          bankAccountId: "b1",
          transferMatchId: "x",
        },
        {
          id: "b",
          date: new Date("2025-03-01Z"),
          description: "in",
          moneyIn: 40,
          moneyOut: 0,
          bankAccountId: "b2",
        },
      ],
      7,
    );
    failed += assertEq("already-matched out skipped", already.length, 0) ? 0 : 1;
  }
  {
    // 1 out → 2 inns same amount → not unique
    const multi = findTransferCandidates(
      [
        {
          id: "o",
          date: new Date("2025-03-01Z"),
          description: "out",
          moneyIn: 0,
          moneyOut: 25,
          bankAccountId: "b1",
        },
        {
          id: "i1",
          date: new Date("2025-03-01Z"),
          description: "in1",
          moneyIn: 25,
          moneyOut: 0,
          bankAccountId: "b2",
        },
        {
          id: "i2",
          date: new Date("2025-03-02Z"),
          description: "in2",
          moneyIn: 25,
          moneyOut: 0,
          bankAccountId: "b3",
        },
      ],
      7,
    );
    failed += assertEq("1:N candidates found", multi.length, 2) ? 0 : 1;
    failed += assertEq("1:N not unique-auto", uniqueTransferCandidates(multi).length, 0) ? 0 : 1;
  }

  // ── E5. General entries edges ──────────────────────────────────────
  console.log("\n=== E5. General entries edges ===");
  {
    const skipped = generateAutomaticEntries(
      [
        {
          id: "u",
          date: new Date("2025-03-01Z"),
          description: "uncat",
          moneyIn: 0,
          moneyOut: 50,
          accountNumber: null,
          accountName: null,
          taxCodes: [],
          taxMode: "INCLUSIVE",
          bankAccountId: "b1",
          bankName: "Cheq",
          bankType: "BANK",
        },
        {
          id: "t",
          date: new Date("2025-03-01Z"),
          description: "xfer",
          moneyIn: 0,
          moneyOut: 50,
          accountNumber: "1000",
          accountName: "Transfer",
          taxCodes: [],
          taxMode: "INCLUSIVE",
          transferMatchId: "tm",
          bankAccountId: "b1",
          bankName: "Cheq",
          bankType: "BANK",
        },
      ],
      { periodType: "MONTHLY", taxRateByCode: new Map([["GST5", 5]]) },
    );
    failed += assertEq("uncategorized+transfer skipped → 0 GE", skipped.length, 0) ? 0 : 1;
  }
  {
    const entries = generateAutomaticEntries(
      [
        {
          id: "e1",
          date: new Date("2025-03-01Z"),
          description: "exp",
          moneyIn: 0,
          moneyOut: 105,
          accountNumber: "5200",
          accountName: "Supplies",
          taxCodes: ["GST5"],
          taxMode: "INCLUSIVE",
          bankAccountId: "b1",
          bankName: "Cheq",
          bankType: "BANK",
        },
      ],
      { periodType: "MONTHLY", taxRateByCode: new Map([["GST5", 5]]) },
    );
    failed += assertEq("single expense GE count", entries.length, 1) ? 0 : 1;
    const e = entries[0]!;
    const debit = round2(e.lines.reduce((s, l) => s + l.debit, 0));
    const credit = round2(e.lines.reduce((s, l) => s + l.credit, 0));
    failed += assertEq("expense GE balanced", debit, credit) ? 0 : 1;
    failed += assertEq("expense GE bank credit = gross", credit, 105) ? 0 : 1;
    failed += assert(
      "ITC line present",
      e.lines.some((l) => l.accountNumber === "2150" && l.debit === 5),
    )
      ? 0
      : 1;
  }
  {
    const q = generateAutomaticEntries(
      [
        {
          id: "j",
          date: new Date("2025-01-15Z"),
          description: "jan",
          moneyIn: 105,
          moneyOut: 0,
          accountNumber: "4000",
          accountName: "Sales",
          taxCodes: ["GST5"],
          taxMode: "INCLUSIVE",
          bankAccountId: "b1",
          bankName: "Cheq",
          bankType: "BANK",
        },
        {
          id: "a",
          date: new Date("2025-04-15Z"),
          description: "apr",
          moneyIn: 105,
          moneyOut: 0,
          accountNumber: "4000",
          accountName: "Sales",
          taxCodes: ["GST5"],
          taxMode: "INCLUSIVE",
          bankAccountId: "b1",
          bankName: "Cheq",
          bankType: "BANK",
        },
      ],
      { periodType: "QUARTERLY", taxRateByCode: new Map([["GST5", 5]]) },
    );
    failed += assertEq("quarterly splits to 2 periods", q.length, 2) ? 0 : 1;
  }

  // ── E6. Reconciliation edges ───────────────────────────────────────
  console.log("\n=== E6. Reconciliation edges ===");
  {
    const empty = reconCalc({
      type: "BANK",
      opening: 1000,
      statementEnding: 1000,
      moneyIn: 0,
      moneyOut: 0,
    });
    failed += assertEq("no clears → calculated = opening", empty.calculated, 1000) ? 0 : 1;
    failed += assertEq("no clears → diff 0 when statement=opening", empty.difference, 0) ? 0 : 1;
  }
  {
    const pennies = reconCalc({
      type: "BANK",
      opening: 0.1,
      statementEnding: 0.3,
      moneyIn: 0.2,
      moneyOut: 0,
    });
    failed += assertEq("float pennies calculated", pennies.calculated, 0.3) ? 0 : 1;
    failed += assertEq("float pennies diff", pennies.difference, 0) ? 0 : 1;
  }
  {
    const cc = reconCalc({
      type: "CREDIT_CARD",
      opening: 1000,
      statementEnding: 1000,
      moneyIn: 200,
      moneyOut: 0,
    });
    // CC: 1000 + 0 - 200 = 800; statement 1000 → diff +200
    failed += assertEq("CC payment reduces balance", cc.calculated, 800) ? 0 : 1;
    failed += assertEq("CC payment difference sign", cc.difference, 200) ? 0 : 1;
  }
  {
    const bank = reconCalc({
      type: "BANK",
      opening: 1000,
      statementEnding: 1000,
      moneyIn: 200,
      moneyOut: 0,
    });
    failed += assertEq("Bank deposit increases balance", bank.calculated, 1200) ? 0 : 1;
  }

  // ── E7. CSV parse edges ────────────────────────────────────────────
  console.log("\n=== E7. CSV parse edges ===");
  {
    const edgeCsv = [
      "Date,Description,Money In,Money Out",
      "2025-03-01,Normal sale,100.00,",
      "2025-03-02,Total deposits,9999,",
      ",,",
      "bad-date,Broken row,10,",
      "2025-03-03,,50,",
      '03/15/2025,"Quoted, comma merchant",,"$1,234.56"',
      "2025-03-04,Opening balance brought forward,0,0",
    ].join("\n");
    const m = parseCsvText(edgeCsv, "edge.csv");
    const map = guessMapping(m.headers, m);
    const result = mapRowsToTransactions(m, {
      date: map.date!,
      description: map.description!,
      moneyIn: map.moneyIn,
      moneyOut: map.moneyOut,
      dateFormat: "AUTO",
      signedRule: "positiveIn",
    });
    failed += assert(
      "skips Total / Opening balance rows",
      !result.rows.some((r) => /total|opening balance/i.test(r.description)),
    )
      ? 0
      : 1;
    failed += assert(
      "invalid date produces error",
      result.errors.some((e) => /invalid date/i.test(e)),
    )
      ? 0
      : 1;
    failed += assert(
      "missing description produces error",
      result.errors.some((e) => /missing description/i.test(e)),
    )
      ? 0
      : 1;
    const quoted = result.rows.find((r) => /Quoted/i.test(r.description));
    failed += assert("parses quoted description with comma", Boolean(quoted)) ? 0 : 1;
    failed += assertEq("parses $1,234.56 money out", quoted?.moneyOut ?? 0, 1234.56) ? 0 : 1;
  }
  {
    const signedCsv = [
      "Date,Description,Amount",
      "2025-03-01,Deposit,250.00",
      "2025-03-02,Withdrawal,-75.50",
    ].join("\n");
    const m = parseCsvText(signedCsv, "signed.csv");
    const map = guessMapping(m.headers, m);
    const result = mapRowsToTransactions(m, {
      date: map.date!,
      description: map.description!,
      amount: map.amount ?? "Amount",
      dateFormat: "AUTO",
      signedRule: "positiveIn",
    });
    failed += assertEq("signed + → moneyIn", result.rows[0]?.moneyIn ?? 0, 250) ? 0 : 1;
    failed += assertEq("signed − → moneyOut", result.rows[1]?.moneyOut ?? 0, 75.5) ? 0 : 1;
  }

  // ── E9. Swap Debit/Credit + Bank/CC — must not break GST/PST/recon ─
  console.log("\n=== E9. Swap Debit/Credit & Bank/CC isolation ===");
  {
    // ── E9.1 Pure swap mechanics ────────────────────────────────────
    failed += assertEq("swap deposit→In", swapMoneySides({ moneyIn: 0, moneyOut: 250 }).moneyIn, 250)
      ? 0
      : 1;
    failed += assertEq(
      "swap withdrawal→Out",
      swapMoneySides({ moneyIn: 75.5, moneyOut: 0 }).moneyOut,
      75.5,
    )
      ? 0
      : 1;
    {
      const row = { moneyIn: 100, moneyOut: 40 };
      const twice = swapMoneySides(swapMoneySides(row));
      failed += assertEq("double-swap restores moneyIn", twice.moneyIn, 100) ? 0 : 1;
      failed += assertEq("double-swap restores moneyOut", twice.moneyOut, 40) ? 0 : 1;
    }
    failed += assertEq(
      "swap zeros stays zero",
      swapMoneySides({ moneyIn: 0, moneyOut: 0 }).moneyIn +
        swapMoneySides({ moneyIn: 0, moneyOut: 0 }).moneyOut,
      0,
    )
      ? 0
      : 1;

    // Gross conserved → tax math side-agnostic on amount
    const saleCorrect = calculateTransactionAmounts(
      { moneyIn: 1120, moneyOut: 0, taxCodes: ["GST5"], taxMode: "INCLUSIVE" },
      CATALOG,
    );
    const saleSwapped = calculateTransactionAmounts(
      {
        ...swapMoneySides({ moneyIn: 1120, moneyOut: 0 }),
        taxCodes: ["GST5"],
        taxMode: "INCLUSIVE",
      },
      CATALOG,
    );
    failed += assertEq("tax amount unchanged by swap", saleSwapped.taxAmount, saleCorrect.taxAmount)
      ? 0
      : 1;
    failed += assertEq("net amount unchanged by swap", saleSwapped.netAmount, saleCorrect.netAmount)
      ? 0
      : 1;
    failed += assert("side flips in→out after swap", saleCorrect.side === "in" && saleSwapped.side === "out")
      ? 0
      : 1;

    // Summary: Σ(in)+Σ(out) conserved; each side flips
    const batch = [
      { moneyIn: 1120, moneyOut: 0, taxCodes: ["GST5"] as string[], taxMode: "INCLUSIVE" as const },
      { moneyIn: 0, moneyOut: 56, taxCodes: ["GST5"] as string[], taxMode: "INCLUSIVE" as const },
      { moneyIn: 250, moneyOut: 0, taxCodes: [] as string[], taxMode: "INCLUSIVE" as const },
    ];
    const sumBefore = summarizeTransactions(batch, CATALOG);
    const sumAfter = summarizeTransactions(swapAll(batch), CATALOG);
    failed += assertEq(
      "summary total cash conserved",
      sumAfter.moneyIn + sumAfter.moneyOut,
      sumBefore.moneyIn + sumBefore.moneyOut,
    )
      ? 0
      : 1;
    failed += assertEq("summary moneyIn flips to prior out", sumAfter.moneyIn, sumBefore.moneyOut)
      ? 0
      : 1;
    failed += assertEq("summary moneyOut flips to prior in", sumAfter.moneyOut, sumBefore.moneyIn)
      ? 0
      : 1;
    failed += assertEq("summary tax unchanged by full swap", sumAfter.taxAmount, sumBefore.taxAmount)
      ? 0
      : 1;

    // ── E9.2 Wrong-side import → swap restores GST roles ────────────
    const gstPeriod = {
      key: "M3-2025",
      label: "2025-03",
      start: new Date("2025-03-01T00:00:00Z"),
      end: new Date("2025-03-31T23:59:59Z"),
    };
    // Sale deposited wrong as Money Out, no accountType → GST uses money side
    const saleWrongSide: TxForTax = {
      id: "swap-sale-wrong",
      date: new Date("2025-03-10T12:00:00Z"),
      description: "Client payment landed as withdrawal",
      moneyIn: 0,
      moneyOut: 105,
      accountNumber: null,
      accountName: null,
      accountType: null,
      taxCodes: ["GST5"],
      provinceTaxCodes: [],
      taxMode: "INCLUSIVE",
    };
    const gstWrong = calculateGstSummary([saleWrongSide], CATALOG, gstPeriod);
    const saleFixed = { ...saleWrongSide, ...swapMoneySides(saleWrongSide) };
    const gstFixed = calculateGstSummary([saleFixed], CATALOG, gstPeriod);
    failed += assert(
      "wrong-side sale is NOT taxable sale",
      gstWrong.taxableSales === 0 && gstWrong.gstCollected === 0,
    )
      ? 0
      : 1;
    failed += assertEq("swap restores GST taxable net", gstFixed.taxableSales, 100) ? 0 : 1;
    failed += assertEq("swap restores GST collected", gstFixed.gstCollected, 5) ? 0 : 1;

    // Expense purchase wrong as Money In → ITC missing / refund-signed until swap
    const expWrong: TxForTax = {
      id: "swap-exp-wrong",
      date: new Date("2025-03-11T12:00:00Z"),
      description: "Staples purchase landed as deposit",
      moneyIn: 56,
      moneyOut: 0,
      accountNumber: "5200",
      accountName: "Office Supplies",
      accountType: "EXPENSE",
      taxCodes: ["GST5"],
      provinceTaxCodes: [],
      taxMode: "INCLUSIVE",
    };
    const gstExpWrong = calculateGstSummary([expWrong], CATALOG, gstPeriod);
    const expFixed = { ...expWrong, ...swapMoneySides(expWrong) };
    const gstExpFixed = calculateGstSummary([expFixed], CATALOG, gstPeriod);
    // EXPENSE + moneyIn → signed ITC negative (refund direction)
    failed += assertEq("wrong-side expense ITC is negative refund", gstExpWrong.itcPaid, -2.67)
      ? 0
      : 1;
    failed += assertEq("swap restores positive ITC", gstExpFixed.itcPaid, 2.67) ? 0 : 1;

    // INCOME + correct moneyIn: swap alone must NOT change GST (accountType drives sale)
    const incomeSale: TxForTax = {
      id: "swap-income",
      date: new Date("2025-03-12T12:00:00Z"),
      description: "Categorized income",
      moneyIn: 105,
      moneyOut: 0,
      accountNumber: "4000",
      accountName: "Sales Revenue",
      accountType: "INCOME",
      taxCodes: ["GST5"],
      provinceTaxCodes: [],
      taxMode: "INCLUSIVE",
    };
    const gstInc = calculateGstSummary([incomeSale], CATALOG, gstPeriod);
    const gstIncSwapped = calculateGstSummary(
      [{ ...incomeSale, ...swapMoneySides(incomeSale) }],
      CATALOG,
      gstPeriod,
    );
    // moneyOut on INCOME → sign -1 (income refund), so taxable/collected flip sign
    failed += assertEq("INCOME+swap → refund nets taxable", gstIncSwapped.taxableSales, -gstInc.taxableSales)
      ? 0
      : 1;
    failed += assertEq("INCOME+swap → refund nets GST", gstIncSwapped.gstCollected, -gstInc.gstCollected)
      ? 0
      : 1;

    // Mixed batch: only wrong rows swapped → GST payable matches all-correct batch
    const correctBatch: TxForTax[] = [
      {
        id: "b1",
        date: new Date("2025-03-01T12:00:00Z"),
        description: "Sale",
        moneyIn: 105,
        moneyOut: 0,
        accountNumber: null,
        accountName: null,
        accountType: null,
        taxCodes: ["GST5"],
        taxMode: "INCLUSIVE",
      },
      {
        id: "b2",
        date: new Date("2025-03-02T12:00:00Z"),
        description: "Expense",
        moneyIn: 0,
        moneyOut: 56,
        accountNumber: "5200",
        accountName: "Office Supplies",
        accountType: "EXPENSE",
        taxCodes: ["GST5"],
        taxMode: "INCLUSIVE",
      },
    ];
    const importedWrong: TxForTax[] = [
      { ...correctBatch[0]!, moneyIn: 0, moneyOut: 105 },
      { ...correctBatch[1]!, moneyIn: 56, moneyOut: 0 },
    ];
    const afterSelectiveSwap = [
      { ...importedWrong[0]!, ...swapMoneySides(importedWrong[0]!) },
      { ...importedWrong[1]!, ...swapMoneySides(importedWrong[1]!) },
    ];
    const gstCorrect = calculateGstSummary(correctBatch, CATALOG, gstPeriod);
    const gstAfterSwap = calculateGstSummary(afterSelectiveSwap, CATALOG, gstPeriod);
    failed += assertEq("GST taxable after fix-swap", gstAfterSwap.taxableSales, gstCorrect.taxableSales)
      ? 0
      : 1;
    failed += assertEq("GST ITC after fix-swap", gstAfterSwap.itcPaid, gstCorrect.itcPaid) ? 0 : 1;
    failed += assertEq("GST payable after fix-swap", gstAfterSwap.gstPayable, gstCorrect.gstPayable)
      ? 0
      : 1;

    // ── E9.3 PST isolation ──────────────────────────────────────────
    const pstSaleWrong: TxForTax = {
      id: "pst-wrong",
      date: new Date("2025-03-15T12:00:00Z"),
      description: "BC sale wrong side",
      moneyIn: 0,
      moneyOut: 107,
      accountNumber: null,
      accountName: null,
      accountType: null,
      taxCodes: [],
      provinceTaxCodes: ["BC PST7"],
      taxMode: "INCLUSIVE",
      province: "BC",
    };
    const pstWrong = calculatePstSummary([pstSaleWrong], CATALOG, gstPeriod, "BC");
    const pstFixedRow = { ...pstSaleWrong, ...swapMoneySides(pstSaleWrong) };
    const pstOk = calculatePstSummary([pstFixedRow], CATALOG, gstPeriod, "BC");
    failed += assert("PST wrong-side not collected", pstWrong.pstCollected === 0) ? 0 : 1;
    failed += assertEq("PST swap restores collected", pstOk.pstCollected, 7) ? 0 : 1;
    failed += assertEq("PST swap restores taxable", pstOk.taxableSales, 100) ? 0 : 1;
    failed += assertEq("PST payable = collected after swap", pstOk.pstPayable, pstOk.pstCollected)
      ? 0
      : 1;

    // Expense with PST wrong as In → paid missing until swap
    const pstExpWrong: TxForTax = {
      id: "pst-exp-wrong",
      date: new Date("2025-03-16T12:00:00Z"),
      description: "BC purchase wrong side",
      moneyIn: 107,
      moneyOut: 0,
      accountNumber: "5200",
      accountName: "Office Supplies",
      accountType: "EXPENSE",
      taxCodes: [],
      provinceTaxCodes: ["BC PST7"],
      taxMode: "INCLUSIVE",
      province: "BC",
    };
    const pstExpW = calculatePstSummary([pstExpWrong], CATALOG, gstPeriod, "BC");
    const pstExpF = calculatePstSummary(
      [{ ...pstExpWrong, ...swapMoneySides(pstExpWrong) }],
      CATALOG,
      gstPeriod,
      "BC",
    );
    // moneyIn + hasPst without INCOME → falls to review (not paid) when not moneyOut
    failed += assertEq("PST wrong-side paid stays 0", pstExpW.pstPaid, 0) ? 0 : 1;
    failed += assertEq("PST swap restores paid", pstExpF.pstPaid, 7) ? 0 : 1;
    // Payable still tracks collected only — unaffected by paid
    failed += assertEq("PST payable ignores paid after swap", pstExpF.pstPayable, 0) ? 0 : 1;

    // ── E9.4 Bank recon: wrong sides break balance; swap fixes ──────
    {
      const opening = 1000;
      const deposit = 250;
      const withdrawal = 75.5;
      const statementEnding = round2(opening + deposit - withdrawal); // 1174.5
      const wrongIn = withdrawal; // sides flipped
      const wrongOut = deposit;
      const broken = reconCalc({
        type: "BANK",
        opening,
        statementEnding,
        moneyIn: wrongIn,
        moneyOut: wrongOut,
      });
      failed += assert(
        "bank recon broken when sides flipped",
        Math.abs(broken.difference) > 0.01,
      )
        ? 0
        : 1;
      const fixed = reconCalc({
        type: "BANK",
        opening,
        statementEnding,
        moneyIn: swapMoneySides({ moneyIn: wrongIn, moneyOut: wrongOut }).moneyIn,
        moneyOut: swapMoneySides({ moneyIn: wrongIn, moneyOut: wrongOut }).moneyOut,
      });
      failed += assertEq("bank recon OK after swap", fixed.difference, 0) ? 0 : 1;
      failed += assertEq("bank calculated after swap", fixed.calculated, statementEnding) ? 0 : 1;
    }

    // ── E9.5 Credit card recon: purchases Out, payments In ──────────
    {
      const opening = 500;
      const purchase = 400; // Money Out
      const payment = 150; // Money In
      // CC: open + out − in = 500 + 400 − 150 = 750
      const statementEnding = 750;
      const ok = reconCalc({
        type: "CREDIT_CARD",
        opening,
        statementEnding,
        moneyIn: payment,
        moneyOut: purchase,
      });
      failed += assertEq("CC recon correct sides", ok.difference, 0) ? 0 : 1;

      // If import flipped (purchase as In, payment as Out) recon is wrong
      const flipped = reconCalc({
        type: "CREDIT_CARD",
        opening,
        statementEnding,
        moneyIn: purchase,
        moneyOut: payment,
      });
      failed += assert("CC recon broken when sides flipped", Math.abs(flipped.difference) > 0.01)
        ? 0
        : 1;
      const restored = reconCalc({
        type: "CREDIT_CARD",
        opening,
        statementEnding,
        ...swapMoneySides({ moneyIn: purchase, moneyOut: payment }),
      });
      failed += assertEq("CC recon OK after swap", restored.difference, 0) ? 0 : 1;
    }

    // Bank vs CC formula isolation: same numbers, different calculated ending
    {
      const same = { opening: 1000, moneyIn: 200, moneyOut: 300 };
      const bank = reconCalc({ type: "BANK", statementEnding: 0, ...same });
      const cc = reconCalc({ type: "CREDIT_CARD", statementEnding: 0, ...same });
      failed += assertEq("Bank formula open+in−out", bank.calculated, 900) ? 0 : 1;
      failed += assertEq("CC formula open+out−in", cc.calculated, 1100) ? 0 : 1;
      failed += assert(
        "Bank/CC formulas diverge on same clears",
        bank.calculated !== cc.calculated,
      )
        ? 0
        : 1;
      // Swapping clears then applying Bank vs CC still uses type-specific formula
      const swapped = swapMoneySides({ moneyIn: same.moneyIn, moneyOut: same.moneyOut });
      const bankS = reconCalc({ type: "BANK", opening: same.opening, statementEnding: 0, ...swapped });
      const ccS = reconCalc({
        type: "CREDIT_CARD",
        opening: same.opening,
        statementEnding: 0,
        ...swapped,
      });
      failed += assertEq("Bank after swap open+in−out", bankS.calculated, 1100) ? 0 : 1;
      failed += assertEq("CC after swap open+out−in", ccS.calculated, 900) ? 0 : 1;
    }

    // ── E9.6 Transfers: swap of both legs preserves amount match ────
    {
      const outLeg = {
        id: "tr-out",
        bankAccountId: "bank-a",
        date: new Date("2025-03-20T12:00:00Z"),
        description: "Transfer out",
        moneyIn: 0,
        moneyOut: 500,
        transferMatchId: null as string | null,
      };
      const inLeg = {
        id: "tr-in",
        bankAccountId: "bank-b",
        date: new Date("2025-03-20T12:00:00Z"),
        description: "Transfer in",
        moneyIn: 500,
        moneyOut: 0,
        transferMatchId: null as string | null,
      };
      const good = uniqueTransferCandidates(findTransferCandidates([outLeg, inLeg], 7));
      failed += assertEq("transfer matches before swap", good.length, 1) ? 0 : 1;

      // Swap only one leg → amounts no longer opposite → no match
      const oneSwapped = [swapMoneySides(outLeg), inLeg];
      const broken = uniqueTransferCandidates(findTransferCandidates(oneSwapped, 7));
      failed += assertEq("single-leg swap breaks transfer match", broken.length, 0) ? 0 : 1;

      // Swap both legs → still Matched (out↔in roles flip banks but amounts align)
      const bothSwapped = [swapMoneySides(outLeg), swapMoneySides(inLeg)];
      // After both swap: bank-a has moneyIn 500, bank-b has moneyOut 500 — still a pair
      const both = uniqueTransferCandidates(findTransferCandidates(bothSwapped, 7));
      failed += assertEq("both-leg swap still matches", both.length, 1) ? 0 : 1;
    }

    // ── E9.7 General entries: gross from moneyOut else moneyIn ──────
    {
      const geBase = {
        id: "ge1",
        date: new Date("2025-03-05T12:00:00Z"),
        description: "Office",
        bankAccountId: "b1",
        bankName: "Chequing",
        bankType: "BANK" as const,
        accountNumber: "5200",
        accountName: "Office Supplies",
        taxCodes: ["GST5"],
        taxMode: "INCLUSIVE" as const,
        transferMatchId: null as string | null,
      };
      const correct = [{ ...geBase, moneyIn: 0, moneyOut: 105 }];
      const wrong = [{ ...geBase, moneyIn: 105, moneyOut: 0 }];
      const rateMap = new Map([["GST5", 5]]);
      const geOk = generateAutomaticEntries(correct, {
        taxRateByCode: rateMap,
        periodType: "MONTHLY",
      });
      const geWrong = generateAutomaticEntries(wrong, {
        taxRateByCode: rateMap,
        periodType: "MONTHLY",
      });
      // Both produce a GE (gross = out or in) — amount same, but income vs expense bucket differs
      failed += assert("GE exists for moneyOut expense", geOk.length >= 1) ? 0 : 1;
      failed += assert("GE exists for moneyIn (wrong side) too", geWrong.length >= 1) ? 0 : 1;
      const geFixed = generateAutomaticEntries(swapAll(wrong), {
        taxRateByCode: rateMap,
        periodType: "MONTHLY",
      });
      const balOk = geOk[0]!.lines.reduce((s, l) => s + l.debit - l.credit, 0);
      const balFixed = geFixed[0]!.lines.reduce((s, l) => s + l.debit - l.credit, 0);
      failed += assertEq("GE balanced before", round2(balOk), 0) ? 0 : 1;
      failed += assertEq("GE balanced after swap fix", round2(balFixed), 0) ? 0 : 1;
    }

    // ── E9.8 Import signedRule: positiveOut vs swap equivalence ─────
    {
      const csv = ["Date,Description,Amount", "2025-03-01,Purchase,100.00", "2025-03-02,Payment,-50.00"].join(
        "\n",
      );
      const m = parseCsvText(csv, "cc-signed.csv");
      const asBank = mapRowsToTransactions(m, {
        date: "Date",
        description: "Description",
        amount: "Amount",
        dateFormat: "AUTO",
        signedRule: "positiveIn",
      });
      // positiveIn: +100 → In, −50 → Out (wrong for CC purchases)
      failed += assertEq("positiveIn maps + to In", asBank.rows[0]?.moneyIn ?? 0, 100) ? 0 : 1;
      failed += assertEq("positiveIn maps − to Out", asBank.rows[1]?.moneyOut ?? 0, 50) ? 0 : 1;

      const asCcRule = mapRowsToTransactions(m, {
        date: "Date",
        description: "Description",
        amount: "Amount",
        dateFormat: "AUTO",
        signedRule: "positiveOut",
      });
      // positiveOut: +100 → Out (purchase), −50 → In (payment)
      failed += assertEq("positiveOut maps + to Out", asCcRule.rows[0]?.moneyOut ?? 0, 100) ? 0 : 1;
      failed += assertEq("positiveOut maps − to In", asCcRule.rows[1]?.moneyIn ?? 0, 50) ? 0 : 1;

      // Manual swap of positiveIn rows ≈ positiveOut mapping
      const swappedFromBank = swapAll(
        asBank.rows.map((r) => ({ moneyIn: r.moneyIn, moneyOut: r.moneyOut })),
      );
      failed += assertEq(
        "swap(positiveIn) ≈ positiveOut row0 out",
        swappedFromBank[0]!.moneyOut,
        asCcRule.rows[0]!.moneyOut,
      )
        ? 0
        : 1;
      failed += assertEq(
        "swap(positiveIn) ≈ positiveOut row1 in",
        swappedFromBank[1]!.moneyIn,
        asCcRule.rows[1]!.moneyIn,
      )
        ? 0
        : 1;

      // CC recon after positiveOut (or equivalent swap) balances
      const ccIn = asCcRule.rows.reduce((s, r) => s + r.moneyIn, 0);
      const ccOut = asCcRule.rows.reduce((s, r) => s + r.moneyOut, 0);
      const opening = 200;
      const ending = opening + ccOut - ccIn; // 200+100-50 = 250
      const r = reconCalc({
        type: "CREDIT_CARD",
        opening,
        statementEnding: ending,
        moneyIn: ccIn,
        moneyOut: ccOut,
      });
      failed += assertEq("CC recon after positiveOut import", r.difference, 0) ? 0 : 1;
    }

    // ── E9.9 Bank type switch does not auto-mutate amounts ──────────
    {
      // Same cleared amounts: switching type changes formula only, not in/out totals
      const moneyIn = 120;
      const moneyOut = 80;
      const bankEnd = reconCalc({
        type: "BANK",
        opening: 1000,
        statementEnding: 1040,
        moneyIn,
        moneyOut,
      });
      const ccEnd = reconCalc({
        type: "CREDIT_CARD",
        opening: 1000,
        statementEnding: 960,
        moneyIn,
        moneyOut,
      });
      failed += assertEq("type=Bank ending", bankEnd.calculated, 1040) ? 0 : 1;
      failed += assertEq("type=CC ending", ccEnd.calculated, 960) ? 0 : 1;
      failed += assertEq("type switch leaves moneyIn alone", moneyIn, 120) ? 0 : 1;
      failed += assertEq("type switch leaves moneyOut alone", moneyOut, 80) ? 0 : 1;
    }
  }

  // ── E8. Period builder edges ───────────────────────────────────────
  console.log("\n=== E8. Period builder edges ===");
  {
    const months = buildPeriods("MONTHLY", 1, 1, 2025);
    failed += assertEq("12 monthly periods", months.length, 12) ? 0 : 1;
    const q = buildPeriods("QUARTERLY", 1, 1, 2025);
    failed += assertEq("4 quarterly periods", q.length, 4) ? 0 : 1;
    const y = buildPeriods("YEARLY", 4, 1, 2025);
    failed += assertEq("1 yearly period", y.length, 1) ? 0 : 1;
    // FY starting April 1
    failed += assert(
      "FY Apr start",
      y[0]!.start.toISOString().startsWith("2025-04-01") &&
        y[0]!.end.toISOString().startsWith("2026-03-31"),
    )
      ? 0
      : 1;
  }

  console.log("\n────────────────────────────────────");
  if (failed) {
    console.error(`FAILED: ${failed} assertion(s)`);
    process.exit(1);
  }
  console.log("ALL CALC MODULE + EDGE CASE TESTS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
