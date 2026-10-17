"use client";

import { useEffect, useState } from "react";

const ROTATING_MESSAGES = [
  "Reading PDF layout (all pages)…",
  "This can take a little while — like ChatGPT scanning a statement…",
  "Separating withdrawals vs deposits from columns…",
  "Joining multi-line descriptions (e-transfers, settlements)…",
  "Checking running balances & opening/closing…",
  "Detecting bank / credit card (CIBC, RBC, TD, BMO, ATB…)…",
  "Validating totals — almost ready…",
];

export function ImportParseLoading({
  fileName,
  statusLine,
}: {
  fileName: string;
  /** Live status from sidebar / bulk parse (e.g. Parsing 1/2: …). */
  statusLine?: string | null;
}) {
  const [index, setIndex] = useState(0);
  const isBulk = /\d+\s*files?/i.test(fileName) || /\/\d+/.test(statusLine ?? "");

  useEffect(() => {
    setIndex(0);
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % ROTATING_MESSAGES.length);
    }, 2800);
    return () => window.clearInterval(id);
  }, [fileName]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="relative flex h-10 w-10 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-teal-400/30" />
            <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-teal-100 border-t-teal-600" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-slate-900">
              {isBulk ? "Parsing statements" : "Parsing statement"}
            </p>
            <p className="truncate text-xs text-slate-500" title={fileName}>
              {fileName}
            </p>
          </div>
        </div>
        {statusLine ? (
          <p className="mb-2 rounded-lg border border-teal-100 bg-teal-50/80 px-3 py-2 text-sm font-medium text-teal-900">
            {statusLine}
          </p>
        ) : null}
        <p className="min-h-[2.75rem] text-sm leading-relaxed text-slate-700 transition-opacity duration-300">
          {ROTATING_MESSAGES[index]}
        </p>
        <p className="mt-3 text-xs text-slate-500">
          {isBulk ? (
            <>
              Bulk import can take <strong>longer</strong> (each PDF may need 10–40s). Do not close
              this page.
            </>
          ) : (
            <>
              AI extract often takes <strong>10–40 seconds</strong> (longer for scanned or many
              pages). Do not close this page.
            </>
          )}
        </p>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full w-2/5 animate-pulse rounded-full bg-teal-500" />
        </div>
      </div>
    </div>
  );
}

/** Sidebar status lines that rotate while parse is busy. */
export const SIDEBAR_PARSE_MESSAGES = [
  "AI is reading the PDF layout — this takes some time…",
  "Mapping Withdrawals vs Deposits columns…",
  "Extracting every posted line page by page…",
  "Reconciling opening / closing balances…",
  "Still parsing Canadian bank format — hang tight…",
];
