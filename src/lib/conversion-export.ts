/** Export helpers for converted / saved transaction rows (CSV, Excel, OFX, QBO). */

export type ExportTransactionRow = {
  date: string;
  description: string;
  moneyIn: number;
  moneyOut: number;
  accountNumber?: string | null;
  accountName?: string | null;
  province?: string | null;
  taxCodes?: string[];
  provinceTaxCodes?: string[];
  taxMode?: string;
  notes?: string | null;
  id?: string;
  bankType?: "BANK" | "CREDIT_CARD";
};

export type ExportFormat = "csv" | "excel" | "ofx" | "qbo";

export type OfxExportOptions = {
  accountId?: string;
  bankId?: string;
  currency?: string;
  accountType?: "BANK" | "CREDIT_CARD";
  /** Intuit FI id for .qbo Web Connect */
  intuBid?: string;
};

function csvCell(value: string | number | null | undefined) {
  const raw = value == null ? "" : String(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function exportTableRows(rows: ExportTransactionRow[]) {
  return rows.map((row) => [
    row.date,
    row.description,
    row.moneyIn,
    row.moneyOut,
    row.accountNumber ?? "",
    row.accountName ?? "",
    row.province ?? "",
    (row.taxCodes ?? []).join(";"),
    (row.provinceTaxCodes ?? []).join(";"),
    row.taxMode ?? "",
    row.notes ?? "",
  ]);
}

const EXPORT_HEADERS = [
  "Date",
  "Description",
  "Money In",
  "Money Out",
  "Account Number",
  "Account Name",
  "Province",
  "Sales Tax Codes",
  "Province Tax Codes",
  "Tax Mode",
  "Notes",
] as const;

export function transactionsToCsv(rows: ExportTransactionRow[]) {
  const lines = [EXPORT_HEADERS.join(",")];
  for (const cells of exportTableRows(rows)) {
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\n");
}

function ofxDate(isoDate: string) {
  const digits = isoDate.replace(/[^0-9]/g, "");
  if (digits.length >= 8) return `${digits.slice(0, 8)}000000`;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "19700101000000";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}000000`;
}

function ofxAmount(row: ExportTransactionRow) {
  const moneyIn = Number(row.moneyIn) || 0;
  const moneyOut = Number(row.moneyOut) || 0;
  if (moneyIn > 0 && moneyOut <= 0) return moneyIn;
  if (moneyOut > 0 && moneyIn <= 0) return -moneyOut;
  return moneyIn - moneyOut;
}

function ofxEscape(value: string) {
  return value.replace(/[<>&]/g, " ").replace(/\s+/g, " ").trim().slice(0, 255);
}

function fitIdForRow(row: ExportTransactionRow, index: number) {
  if (row.id) return row.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32) || `LD${index + 1}`;
  return `LD${index + 1}`;
}

/** OFX SGML (bank or credit card). QBO is the same payload with Intuit metadata. */
export function transactionsToOfx(
  rows: ExportTransactionRow[],
  options?: OfxExportOptions & { qbo?: boolean },
) {
  const creditCard =
    options?.accountType === "CREDIT_CARD" ||
    rows.some((r) => r.bankType === "CREDIT_CARD");
  const currency = options?.currency ?? "CAD";
  const acctId = ofxEscape(options?.accountId || "0000");
  const bankId = ofxEscape(options?.bankId || "0000");
  const dates = rows.map((r) => ofxDate(r.date)).sort();
  const dtStart = dates[0] ?? ofxDate(new Date().toISOString());
  const dtEnd = dates[dates.length - 1] ?? dtStart;
  const dtserver = ofxDate(new Date().toISOString());

  const stmtTrns = rows
    .map((row, index) => {
      const amt = ofxAmount(row);
      const trnType = amt >= 0 ? "CREDIT" : "DEBIT";
      const name = ofxEscape(row.description || "Transaction");
      const memoParts = [row.accountName, row.notes].filter(Boolean).join(" — ");
      const memo = memoParts ? `\n<MEMO>${ofxEscape(memoParts)}` : "";
      return `<STMTTRN>
<TRNTYPE>${trnType}
<DTPOSTED>${ofxDate(row.date)}
<TRNAMT>${amt.toFixed(2)}
<FITID>${fitIdForRow(row, index)}
<NAME>${name}${memo}
</STMTTRN>`;
    })
    .join("\n");

  const accountBlock = creditCard
    ? `<CCACCTFROM>
<ACCTID>${acctId}
</CCACCTFROM>`
    : `<BANKACCTFROM>
<BANKID>${bankId}
<ACCTID>${acctId}
<ACCTTYPE>CHECKING
</BANKACCTFROM>`;

  const msgWrapper = creditCard
    ? `<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<CCSTMTRS>
<CURDEF>${currency}
${accountBlock}
<BANKTRANLIST>
<DTSTART>${dtStart}
<DTEND>${dtEnd}
${stmtTrns}
</BANKTRANLIST>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>`
    : `<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>${currency}
${accountBlock}
<BANKTRANLIST>
<DTSTART>${dtStart}
<DTEND>${dtEnd}
${stmtTrns}
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>`;

  const intuBid = options?.intuBid ?? "00000";
  const fiBlock = options?.qbo
    ? `<FI>
<ORG>LedgerDesk
<FID>${ofxEscape(intuBid)}
</FI>
`
    : "";

  const header = [
    "OFXHEADER:100",
    "DATA:OFXSGML",
    "VERSION:102",
    "SECURITY:NONE",
    "ENCODING:USASCII",
    "CHARSET:1252",
    "COMPRESSION:NONE",
    "OLDFILEUID:NONE",
    "NEWFILEUID:NONE",
    ...(options?.qbo ? [`INTU.BID:${intuBid}`] : []),
    "",
  ].join("\n");

  return `${header}
<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>${dtserver}
<LANGUAGE>ENG
${fiBlock}</SONRS>
</SIGNONMSGSRSV1>
${msgWrapper}
</OFX>
`;
}

export function transactionsToQbo(rows: ExportTransactionRow[], options?: OfxExportOptions) {
  return transactionsToOfx(rows, { ...options, qbo: true });
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsvFile(filename: string, csv: string) {
  downloadBlob(filename, new Blob([csv], { type: "text/csv;charset=utf-8" }));
}

export function downloadTextFile(
  filename: string,
  text: string,
  mime = "application/octet-stream",
) {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

export async function downloadTransactionsExcel(
  filename: string,
  rows: ExportTransactionRow[],
) {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([
    [...EXPORT_HEADERS],
    ...exportTableRows(rows),
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Transactions");
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

export function exportFilename(format: ExportFormat, stamp = new Date()) {
  const y = stamp.getFullYear();
  const m = String(stamp.getMonth() + 1).padStart(2, "0");
  const d = String(stamp.getDate()).padStart(2, "0");
  const base = `ledgerdesk-transactions-${y}-${m}-${d}`;
  switch (format) {
    case "excel":
      return `${base}.xlsx`;
    case "qbo":
      return `${base}.qbo`;
    case "ofx":
      return `${base}.ofx`;
    case "csv":
    default:
      return `${base}.csv`;
  }
}

export const PREFERRED_FOLDER_STORAGE_KEY = "ledgerdesk:preferred-folder";
export const LAST_SAVED_CONVERSION_KEY = "ledgerdesk:last-saved-conversion";
export const LOADED_CONVERSION_CONTEXT_KEY = "ledgerdesk:loaded-conversion-context";
/** Set before navigating to Transactions when user clicks New from another tab/page. */
export const REQUEST_NEW_CONVERSION_KEY = "ledgerdesk:request-new-conversion";

export type LoadedConversionContext = {
  organizationId: string;
  conversionId: string;
  conversionName: string;
  folderId: string;
  folderName: string;
};

export function preferredFolderStorageKey(organizationId: string) {
  return `${PREFERRED_FOLDER_STORAGE_KEY}:${organizationId}`;
}

export function loadedConversionStorageKey(organizationId: string) {
  return `${LOADED_CONVERSION_CONTEXT_KEY}:${organizationId}`;
}

export function readLoadedConversionContext(
  organizationId: string,
): LoadedConversionContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(loadedConversionStorageKey(organizationId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LoadedConversionContext;
    if (parsed.organizationId !== organizationId) return null;
    if (!parsed.conversionId || !parsed.folderId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeLoadedConversionContext(context: LoadedConversionContext) {
  localStorage.setItem(
    loadedConversionStorageKey(context.organizationId),
    JSON.stringify(context),
  );
}

export function clearLoadedConversionContext(organizationId: string) {
  localStorage.removeItem(loadedConversionStorageKey(organizationId));
}
