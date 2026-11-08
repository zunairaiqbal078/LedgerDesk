/**
 * Shared table export helpers — plain ASCII amounts (no $, no locale symbols).
 */

import * as XLSX from "xlsx";

/** Always 2 decimals, ASCII only. Example: 1234.56 */
export function formatExportAmount(value: number | string | null | undefined): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "0.00";
  const rounded = Math.round(n * 100) / 100;
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const [whole, frac = "00"] = abs.toFixed(2).split(".");
  return `${sign}${whole}.${frac}`;
}

/** Numeric cell for Excel (true number, not a currency string). */
export function exportAmountNumber(value: number | string | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Strip characters that break PDF fonts / Excel displays. */
export function sanitizeExportText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ") // nbsp
    .replace(/[\u2013\u2014\u2212]/g, "-") // en/em/minus
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/→/g, "to")
    .replace(/←/g, "from")
    .replace(/\$/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "") // keep printable ASCII + tab/CR/LF
    .trim();
}

/** Drop redundant "Custom -" / "Custom —" prefix; keep the date range only. */
export function shortenPeriodLabel(value: string | null | undefined): string {
  let s = sanitizeExportText(value);
  s = s.replace(/^Custom\s*[-:]\s*/i, "").trim();
  return s || "-";
}

/**
 * Truncate text so it fits within maxWidth (pt) for the current jsPDF font.
 * `measure` should return text width in the same unit as maxWidth.
 */
export function fitExportText(
  text: string,
  maxWidth: number,
  measure: (t: string) => number,
): string {
  const clean = sanitizeExportText(text);
  if (!clean) return "";
  if (measure(clean) <= maxWidth) return clean;
  let t = clean;
  while (t.length > 1 && measure(`${t}...`) > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}...`;
}

export function csvEscape(value: string | number | null | undefined): string {
  const raw = value == null ? "" : String(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

export function rowsToCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) => r.map(csvEscape).join(",")),
  ];
  // BOM helps Excel open UTF-8 correctly without mojibake
  return `\uFEFF${lines.join("\r\n")}`;
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, csv: string) {
  downloadBlob(filename, new Blob([csv], { type: "text/csv;charset=utf-8" }));
}

export function downloadExcelAoa(
  filename: string,
  sheetName: string,
  aoa: Array<Array<string | number | null | undefined>>,
) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

/** Assert export content has no currency / fancy symbols (for tests). */
export function assertCleanExportText(text: string, label = "export") {
  if (text.includes("$")) {
    throw new Error(`${label}: unexpected $ currency symbol`);
  }
  if (/[\u00a0\u2013\u2014\u2018\u2019\u201c\u201d\u2026→←]/.test(text)) {
    throw new Error(`${label}: unexpected fancy unicode symbols`);
  }
}
