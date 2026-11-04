/** Hold File objects across a tab navigation to Transactions (File can't go in URL/storage). */

const KEY = "__ledgerdeskPendingImportFiles";

/** URL where TransactionsWorkspace listens for imports. */
export const TRANSACTIONS_IMPORT_PATH = "/app?tab=transactions";

/** True only when the transactions workspace is mounted (not /app/tax-codes, etc.). */
export function isTransactionsImportSurface(pathname: string, tab: string | null): boolean {
  return pathname === "/app" && (!tab || tab === "transactions");
}

export function stashPendingImportFiles(files: File[]) {
  if (typeof window === "undefined") return;
  (window as unknown as Record<string, File[]> )[KEY] = files;
}

export function takePendingImportFiles(): File[] | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, File[] | undefined>;
  const files = w[KEY];
  delete w[KEY];
  return files?.length ? files : null;
}

export function isImportBusyStatus(status: string) {
  return /importing|parsing|reading|extract|ocr|AI is|hang tight|takes some time|mapping|reconcil/i.test(
    status,
  );
}
