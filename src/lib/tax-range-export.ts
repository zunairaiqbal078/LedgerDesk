import type { TaxPdfLine } from "@/lib/tax-report-pdf";

function csvEscape(value: string | number) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeFilePart(value: string) {
  return value.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(0, 80) || "export";
}

export type TaxExportTotals = {
  taxableSales: number;
  nonTaxableSales: number;
  collected: number;
  paidOrItc: number;
  payable: number;
};

export async function downloadTaxRangeExcel(opts: {
  kind: "gst" | "pst";
  clientName: string;
  start: string;
  end: string;
  totals: TaxExportTotals;
  lines: TaxPdfLine[];
}) {
  const XLSX = await import("xlsx");
  const taxLabel = opts.kind === "gst" ? "GST" : "PST";
  const paidLabel = opts.kind === "gst" ? "ITCs Paid" : "PST Paid on Purchases";
  const payableLabel = opts.kind === "gst" ? "GST Payable" : "PST Payable";
  const collectedLabel = opts.kind === "gst" ? "GST Collected" : "PST Collected";

  const summaryRows = [
    ["Client", opts.clientName],
    ["Report", `${taxLabel} Calculation`],
    ["Start", opts.start],
    ["End", opts.end],
    [],
    ["Metric", "Amount"],
    ["Taxable Sales", opts.totals.taxableSales],
    ["Non-Taxable Sales", opts.totals.nonTaxableSales],
    [collectedLabel, opts.totals.collected],
    [paidLabel, opts.totals.paidOrItc],
    [payableLabel, opts.totals.payable],
  ];

  const lineRows = [
    ["Date", "Description", "Account", "Account Type", "Role", "Net", taxLabel],
    ...opts.lines.map((l) => [
      l.date,
      l.description,
      l.account,
      l.accountType,
      l.role,
      l.net,
      l.tax,
    ]),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lineRows), "Transactions");
  const filename = `${safeFilePart(opts.clientName)}_${opts.kind.toUpperCase()}_${opts.start}_to_${opts.end}.xlsx`;
  XLSX.writeFile(wb, filename);
}

export function downloadTaxRangeCsv(opts: {
  kind: "gst" | "pst";
  clientName: string;
  start: string;
  end: string;
  totals: TaxExportTotals;
  lines: TaxPdfLine[];
}) {
  const taxLabel = opts.kind === "gst" ? "GST" : "PST";
  const paidLabel = opts.kind === "gst" ? "ITCs Paid" : "PST Paid on Purchases";
  const payableLabel = opts.kind === "gst" ? "GST Payable" : "PST Payable";
  const collectedLabel = opts.kind === "gst" ? "GST Collected" : "PST Collected";

  const rows: string[][] = [
    ["Client", opts.clientName],
    ["Report", `${taxLabel} Calculation`],
    ["Start", opts.start],
    ["End", opts.end],
    [],
    ["Metric", "Amount"],
    ["Taxable Sales", String(opts.totals.taxableSales)],
    ["Non-Taxable Sales", String(opts.totals.nonTaxableSales)],
    [collectedLabel, String(opts.totals.collected)],
    [paidLabel, String(opts.totals.paidOrItc)],
    [payableLabel, String(opts.totals.payable)],
    [],
    ["Date", "Description", "Account", "Account Type", "Role", "Net", taxLabel],
    ...opts.lines.map((l) => [
      l.date,
      l.description,
      l.account,
      l.accountType,
      l.role,
      String(l.net),
      String(l.tax),
    ]),
  ];

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const filename = `${safeFilePart(opts.clientName)}_${opts.kind.toUpperCase()}_${opts.start}_to_${opts.end}.csv`;
  downloadBlob(filename, new Blob([csv], { type: "text/csv;charset=utf-8" }));
}
