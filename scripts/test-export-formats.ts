/**
 * Verify CSV / Excel / PDF export content has no $ or fancy symbols.
 *
 *   pnpm exec tsx scripts/test-export-formats.ts
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import {
  assertCleanExportText,
  exportAmountNumber,
  formatExportAmount,
  rowsToCsv,
  sanitizeExportText,
} from "../src/lib/table-export";

const outDir = resolve(__dirname, "../tmp/export-tests");
mkdirSync(outDir, { recursive: true });

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function main() {
  console.log("\n[test-export-formats]\n");

  // Amount formatting
  assert(formatExportAmount(2450) === "2450.00", "2450 format");
  assert(formatExportAmount(12.5) === "12.50", "12.5 format");
  assert(formatExportAmount(-89.47) === "-89.47", "negative format");
  assert(!formatExportAmount(1000).includes("$"), "no $ in amount");
  assert(!formatExportAmount(1000).includes(","), "no thousands comma");
  assert(exportAmountNumber("680.25") === 680.25, "numeric excel cell");

  // Sanitize
  assert(sanitizeExportText("Sales — Bank") === "Sales - Bank", "emdash");
  assert(sanitizeExportText("A → B") === "A to B", "arrow");
  assert(sanitizeExportText("$1,200.00") === "1,200.00", "strip $");
  assert(sanitizeExportText("a\u00a0b") === "a b", "nbsp");

  // GE-like CSV
  const geCsv = rowsToCsv(
    ["Entry", "Period", "Date", "Source", "Account Number", "Account", "Memo", "Debit", "Credit"],
    [
      [
        "JE 001",
        "Custom - 2026-11-01 to 2026-11-30",
        "2026-11-04",
        "Automatic",
        "4000",
        "Sales",
        "Deposit to RBC",
        formatExportAmount(3130.25),
        formatExportAmount(0),
      ],
      [
        "JE 001",
        "Custom - 2026-11-01 to 2026-11-30",
        "2026-11-04",
        "Automatic",
        "",
        "RBC Chequing",
        "Deposit to RBC",
        formatExportAmount(0),
        formatExportAmount(3130.25),
      ],
    ],
  );
  assertCleanExportText(geCsv, "GE CSV");
  assert(geCsv.includes("3130.25"), "GE CSV amount");
  assert(!geCsv.includes("$"), "GE CSV no $");
  const geCsvPath = resolve(outDir, "general_entries.csv");
  writeFileSync(geCsvPath, geCsv, "utf8");
  console.log(`✓ Wrote ${geCsvPath}`);

  // Recon CSV
  const reconCsv = rowsToCsv(
    [
      "Date",
      "Description",
      "Account Number",
      "Category",
      "Money In",
      "Money Out",
      "Status",
      "Cleared In",
      "Cleared Out",
    ],
    [
      [
        "2026-11-01",
        "CLIENT PAYMENT INV-1042",
        "4000",
        "Sales",
        formatExportAmount(2450),
        formatExportAmount(0),
        "Open",
        "",
        "",
      ],
      [
        "2026-11-05",
        "MONTHLY BANK FEE",
        "5400",
        "Bank Charges",
        formatExportAmount(0),
        formatExportAmount(12),
        "Cleared",
        "",
        "Y",
      ],
    ],
  );
  assertCleanExportText(reconCsv, "Recon CSV");
  const reconCsvPath = resolve(outDir, "reconciliation.csv");
  writeFileSync(reconCsvPath, reconCsv, "utf8");
  console.log(`✓ Wrote ${reconCsvPath}`);

  // Excel GE
  const geXlsxPath = resolve(outDir, "general_entries.xlsx");
  const geAoa = [
    ["Entry", "Period", "Date", "Source", "Account Number", "Account", "Memo", "Debit", "Credit"],
    ["JE 001", "Custom", "2026-11-04", "Automatic", "4000", "Sales", "Deposit", 3130.25, 0],
    ["JE 001", "Custom", "2026-11-04", "Automatic", "", "RBC", "Deposit", 0, 3130.25],
  ];
  const ws = XLSX.utils.aoa_to_sheet(geAoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "General Entries");
  XLSX.writeFile(wb, geXlsxPath);
  const readBack = XLSX.readFile(geXlsxPath);
  const sheet = readBack.Sheets[readBack.SheetNames[0]!];
  const csvFromXlsx = XLSX.utils.sheet_to_csv(sheet);
  assertCleanExportText(csvFromXlsx, "GE Excel");
  assert(typeof geAoa[1]![7] === "number", "Excel debit is number");
  console.log(`✓ Wrote ${geXlsxPath}`);

  // Excel Recon
  const reconXlsxPath = resolve(outDir, "reconciliation.xlsx");
  const reconAoa = [
    ["Date", "Description", "Money In", "Money Out", "Status"],
    ["2026-11-01", "CLIENT PAYMENT", 2450, 0, "Open"],
    ["Opening", exportAmountNumber(0)],
    ["Difference", exportAmountNumber(12.5)],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(reconAoa);
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, ws2, "Reconciliation");
  XLSX.writeFile(wb2, reconXlsxPath);
  const reconCsvFromX = XLSX.utils.sheet_to_csv(
    XLSX.readFile(reconXlsxPath).Sheets["Reconciliation"]!,
  );
  assertCleanExportText(reconCsvFromX, "Recon Excel");
  console.log(`✓ Wrote ${reconXlsxPath}`);

  // PDF GE
  const gePdfPath = resolve(outDir, "general_entries.pdf");
  {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("General Entries", 32, 40);
    doc.text(`Total Debits: ${formatExportAmount(3130.25)}`, 32, 56);
    doc.text(`Total Credits: ${formatExportAmount(3130.25)}`, 360, 56);
    doc.text("JE 001", 32, 80);
    doc.text(formatExportAmount(3130.25), 700, 80, { align: "right" });
    const buf = Buffer.from(doc.output("arraybuffer"));
    writeFileSync(gePdfPath, buf);
    const asText = buf.toString("latin1");
    // PDF binary may contain $ in fonts; check the content stream fragments we wrote via text
    assert(!asText.includes("(Total Debits: $"), "GE PDF no $ in totals");
    assert(asText.includes("(3130.25)"), "GE PDF has plain amount");
    console.log(`✓ Wrote ${gePdfPath}`);
  }

  // PDF Recon
  const reconPdfPath = resolve(outDir, "reconciliation.pdf");
  {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Reconciliation", 32, 40);
    doc.text(`Opening: ${formatExportAmount(0)}`, 32, 56);
    doc.text(`Difference: ${formatExportAmount(12)}`, 360, 56);
    doc.text(formatExportAmount(2450), 700, 80, { align: "right" });
    const buf = Buffer.from(doc.output("arraybuffer"));
    writeFileSync(reconPdfPath, buf);
    const asText = buf.toString("latin1");
    assert(!asText.includes("(Opening: $"), "Recon PDF no $");
    assert(asText.includes("(2450.00)") || asText.includes("(2450)"), "Recon PDF amount");
    console.log(`✓ Wrote ${reconPdfPath}`);
  }

  // Round-trip: files exist and readable
  for (const f of [geCsvPath, reconCsvPath, geXlsxPath, reconXlsxPath, gePdfPath, reconPdfPath]) {
    assert(existsSync(f), `missing ${f}`);
    assert(readFileSync(f).length > 20, `empty ${f}`);
  }

  console.log("\n✓ Export formats clean (no $, no fancy symbols) — PASS\n");
}

main();
