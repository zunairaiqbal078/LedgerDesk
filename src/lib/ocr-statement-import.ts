import { parseStatementText } from "@/lib/statement-text";
import type { ParsedImportRow } from "@/lib/import-parser";

type TesseractLoggerMessage = {
  status?: string;
  progress?: number;
};

type TesseractGlobal = {
  recognize: (
    image: File | Blob,
    lang?: string,
    options?: { logger?: (message: TesseractLoggerMessage) => void },
  ) => Promise<{ data: { text: string } }>;
};

declare global {
  interface Window {
    Tesseract?: TesseractGlobal;
  }
}

function loadTesseractFromCdn(): Promise<TesseractGlobal> {
  if (typeof window === "undefined") {
    throw new Error("Image OCR runs in the browser.");
  }
  if (window.Tesseract) return Promise.resolve(window.Tesseract);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-ledgerdesk-tesseract="1"]');
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.Tesseract) resolve(window.Tesseract);
        else reject(new Error("OCR library loaded but is unavailable."));
      });
      existing.addEventListener("error", () => reject(new Error("Could not load OCR library.")));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.async = true;
    script.dataset.ledgerdeskTesseract = "1";
    script.onload = () => {
      if (window.Tesseract) resolve(window.Tesseract);
      else reject(new Error("OCR library loaded but is unavailable."));
    };
    script.onerror = () =>
      reject(new Error("Could not load OCR library. Check your internet connection and reload."));
    document.head.appendChild(script);
  });
}

export async function parseStatementFromImageFile(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<{ rows: ParsedImportRow[]; errors: string[] }> {
  const Tesseract = await loadTesseractFromCdn();
  const result = await Tesseract.recognize(file, "eng", {
    logger: (message) => {
      if (message.status === "recognizing text" && typeof message.progress === "number") {
        onProgress?.(message.progress);
      }
    },
  });

  const parsed = parseStatementText(result.data.text ?? "");
  if (!parsed.rows.length) {
    return {
      rows: [],
      errors: [
        parsed.errors[0] ??
          "OCR finished but no transactions were detected. Try a clearer photo or export CSV/Excel from your bank.",
      ],
    };
  }
  return parsed;
}
