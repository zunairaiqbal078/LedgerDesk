/** Hold File objects across a tab navigation to Transactions (File can't go in URL/storage). */

const KEY = "__ledgerdeskPendingImportFiles";

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
