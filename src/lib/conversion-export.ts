/** CSV export for converted / saved transaction rows (QuickBooks-style columns). */

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
};

function csvCell(value: string | number | null | undefined) {
  const raw = value == null ? "" : String(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

export function transactionsToCsv(rows: ExportTransactionRow[]) {
  const header = [
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
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
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
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function downloadCsvFile(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
