import { parseStatementText } from "@/lib/statement-text";
import type { ParsedImportRow } from "@/lib/import-parser";

const PDFJS_WORKER =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/build/pdf.worker.min.mjs";

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
    throw new Error("PDF OCR runs in the browser.");
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

async function pageToPngBlob(
  page: import("pdfjs-dist").PDFPageProxy,
  scale = 2,
): Promise<Blob> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare PDF page for OCR.");
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not render PDF page."))),
      "image/png",
    );
  });
}

/** OCR each PDF page in the browser when normal text extraction finds no rows. */
export async function parseStatementFromPdfFileViaOcr(
  file: File,
  onProgress?: (label: string, fraction: number) => void,
): Promise<{ rows: ParsedImportRow[]; errors: string[] }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

  const Tesseract = await loadTesseractFromCdn();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pageCount = doc.numPages;
  let fullText = "";

  try {
    for (let i = 1; i <= pageCount; i++) {
      onProgress?.(`OCR page ${i} of ${pageCount}`, (i - 1) / Math.max(pageCount, 1));
      const page = await doc.getPage(i);
      const blob = await pageToPngBlob(page);
      const result = await Tesseract.recognize(blob, "eng");
      fullText += `\n${result.data.text ?? ""}`;
    }
  } finally {
    await doc.destroy();
  }

  onProgress?.("Parsing transactions…", 1);
  const parsed = parseStatementText(fullText);
  if (!parsed.rows.length) {
    return {
      rows: [],
      errors: [
        parsed.errors[0] ??
          "OCR finished but no transactions were detected. Try CSV/Excel from your bank.",
      ],
    };
  }
  return parsed;
}
