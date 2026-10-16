export const OCR_PDF_FALLBACK_KEY = "ledgerdesk-ocr-pdf-fallback";

export function isOcrPdfFallbackEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(OCR_PDF_FALLBACK_KEY);
  return stored !== "false";
}
