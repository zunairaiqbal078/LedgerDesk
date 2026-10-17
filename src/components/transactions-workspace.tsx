"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TransactionRowPatch } from "@/app/actions/saves";
import { toast } from "sonner";
import {
  applyRulesToTransactionsAction,
  deleteAllTransactionsAction,
  deleteTransactionsAction,
  duplicateTransactionsAction,
  importTransactionsAction,
  swapDebitCreditAction,
} from "@/app/actions/books";
import {
  clearLoadedConversionContext,
  type LoadedConversionContext,
  REQUEST_NEW_CONVERSION_KEY,
  writeLoadedConversionContext,
} from "@/lib/conversion-export";
import { takePendingImportFiles } from "@/lib/pending-import";
import { TransactionTaxPickerModal } from "@/components/transaction-tax-picker-modal";
import { BulkDeleteTransactionsModal } from "@/components/bulk-delete-transactions-modal";
import { BulkEditTransactionsModal } from "@/components/bulk-edit-transactions-modal";
import { DualScrollArea } from "@/components/dual-scroll-area";
import { EditableTransactionRow } from "@/components/editable-transaction-row";
import { SaveConversionDialog } from "@/components/save-conversion-dialog";
import { ImportGuardModal } from "@/components/import-guard-modal";
import {
  ImportParseLoading,
  SIDEBAR_PARSE_MESSAGES,
} from "@/components/import-parse-loading";
import {
  guessMapping,
  mapRowsToTransactions,
  parseImportFile,
  type ColumnMapping,
  type DateFormatPreference,
  type ImportMatrix,
  type ParsedImportRow,
} from "@/lib/import-parser";
import { isOfxOrQboFileName, parseOfxOrQbo } from "@/lib/ofx-parser";
import {
  calculateTransactionAmounts,
  summarizeTransactions,
} from "@/lib/transaction-math";
import type { TaxCodeInfo } from "@/lib/tax-reports";
import { parseBankXml } from "@/lib/xml-parser";
import { Button, Card, Input, Label, Select } from "@/components/ui";
import { CONVERTER_EVENTS } from "@/lib/converter-events";

type TxRow = {
  id: string;
  bankAccountId: string;
  date: string;
  description: string;
  moneyIn: number;
  moneyOut: number;
  accountNumber: string | null;
  accountName: string | null;
  province: string | null;
  taxCodes: string[];
  provinceTaxCodes: string[];
  taxMode: string;
  notes: string | null;
  bankName?: string;
  bankType?: "BANK" | "CREDIT_CARD";
};

type AccountOption = { number: string; name: string };
type TaxOption = {
  code: string;
  name?: string;
  rate?: number;
  kind?: string;
  province?: string | null;
};
type BankOption = { id: string; name: string; type: "BANK" | "CREDIT_CARD" };
type FolderOption = { id: string; name: string };

type PendingRows = Array<{
  date: string;
  description: string;
  moneyIn: number;
  moneyOut: number;
  notes?: string;
  externalTransactionId?: string;
  accountNumber?: string;
  accountName?: string;
  province?: string;
}>;

function rowsFromParsed(rows: ParsedImportRow[]): PendingRows {
  return rows.map((row) => ({
    date: row.date.toISOString(),
    description: row.description,
    moneyIn: row.moneyIn,
    moneyOut: row.moneyOut,
    notes: row.notes,
    externalTransactionId: row.externalTransactionId,
    accountNumber: row.accountNumber,
    accountName: row.accountName,
    province: row.province,
  }));
}

/** Flip Money In ↔ Money Out (debit/credit). */
function swapMoneySides<T extends { moneyIn: number; moneyOut: number }>(rows: T[]): T[] {
  return rows.map((row) => ({
    ...row,
    moneyIn: row.moneyOut,
    moneyOut: row.moneyIn,
  }));
}

function readSidebarStatementIsCreditCard(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("ledgerdesk-statement-type") === "Credit Card";
}

function postingAccountLabel(tx: TxRow) {
  return tx.bankName ?? "—";
}

function statementTypeLabel(tx: TxRow) {
  if (tx.bankType === "CREDIT_CARD") return "Credit Card";
  if (tx.bankType === "BANK") return "Bank";
  return tx.bankName ? "Bank" : "—";
}

function htmlDateFormatToPreference(label: string): DateFormatPreference {
  switch (label) {
    case "MM/DD/YYYY":
      return "MDY";
    case "DD/MM/YYYY":
      return "DMY";
    case "YYYY-MM-DD":
    case "YYYY/MM/DD":
      return "YMD";
    default:
      return "AUTO";
  }
}

export function TransactionsWorkspace({
  organizationId,
  initialLoadedConversion,
  transactions,
  accounts,
  taxCodes,
  taxCatalog,
  banks,
  folders,
  bankName,
  activeBankId,
  canEdit,
}: {
  organizationId: string;
  initialLoadedConversion?: LoadedConversionContext | null;
  transactions: TxRow[];
  accounts: AccountOption[];
  taxCodes: TaxOption[];
  taxCatalog: TaxCodeInfo[];
  banks: BankOption[];
  folders: FolderOption[];
  bankName: string | null;
  activeBankId: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(transactions);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setRows(transactions);
  }, [transactions]);

  useEffect(() => {
    if (initialLoadedConversion) {
      writeLoadedConversionContext(initialLoadedConversion);
    }
  }, [initialLoadedConversion]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(REQUEST_NEW_CONVERSION_KEY) !== "1") return;
    sessionStorage.removeItem(REQUEST_NEW_CONVERSION_KEY);
    if (!canEdit) {
      toast.error("You cannot start a new conversion.");
      return;
    }
    if (rows.length > 0) {
      pendingImportFilesRef.current = null;
      setImportGuardMode("new");
      setImportGuardOpen(true);
    }
  }, [canEdit, rows.length]);

  const handlePatched = useCallback((patch: TransactionRowPatch) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === patch.id
          ? {
              ...row,
              ...patch,
              taxCodes: patch.taxCodes,
              provinceTaxCodes: patch.provinceTaxCodes,
            }
          : row,
      ),
    );
    setDirtyRowIds((prev) => {
      const next = new Set(prev);
      next.delete(patch.id);
      return next;
    });
  }, []);

  const handleDirtyChange = useCallback((id: string, dirty: boolean) => {
    setDirtyRowIds((prev) => {
      const next = new Set(prev);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const registerRowSaver = useCallback((id: string, saver: () => Promise<boolean>) => {
    rowSaversRef.current.set(id, saver);
  }, []);

  const unregisterRowSaver = useCallback((id: string) => {
    rowSaversRef.current.delete(id);
  }, []);
  const [query, setQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [matrix, setMatrix] = useState<ImportMatrix | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [pendingRows, setPendingRows] = useState<PendingRows | null>(null);
  const [pendingLabel, setPendingLabel] = useState("");
  const [parseLoadingFile, setParseLoadingFile] = useState<string | null>(null);
  const [parseLoadingStatus, setParseLoadingStatus] = useState<string | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(true);
  const [pendingBankHint, setPendingBankHint] = useState<{
    institutionName: string | null;
    statementType: "BANK" | "CREDIT_CARD" | null;
    accountLast4?: string | null;
    openingBalance?: number | null;
    closingBalance?: number | null;
    totalWithdrawals?: number | null;
    totalDeposits?: number | null;
    periodLabel?: string | null;
  } | null>(null);
  const parseStatusTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [applyRulesOnImport, setApplyRulesOnImport] = useState(true);
  const [importBankMode, setImportBankMode] = useState<"existing" | "new">(
    banks.length ? "existing" : "new",
  );
  const [importBankId, setImportBankId] = useState(activeBankId ?? banks[0]?.id ?? "");
  const [newBankName, setNewBankName] = useState("");
  const [newBankType, setNewBankType] = useState<"BANK" | "CREDIT_CARD">("BANK");
  /** Manual flip on import preview when Debit/Credit sides were imported backwards. */
  const [previewSwapSides, setPreviewSwapSides] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [importGuardOpen, setImportGuardOpen] = useState(false);
  const [importGuardMode, setImportGuardMode] = useState<"import" | "new">("import");
  const pendingImportFilesRef = useRef<File[] | null>(null);
  const replaceBeforeNextImportRef = useRef(false);
  const [taxPickerTxId, setTaxPickerTxId] = useState<string | null>(null);
  const [dirtyRowIds, setDirtyRowIds] = useState<Set<string>>(new Set());
  const rowSaversRef = useRef(new Map<string, () => Promise<boolean>>());
  const [moneySide, setMoneySide] = useState<"all" | "in" | "out" | "both">("all");
  const [sortBy, setSortBy] = useState("original");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [dateFormatPref, setDateFormatPref] = useState<DateFormatPreference>("AUTO");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const stored = localStorage.getItem("ledgerdesk-date-format");
    if (stored) setDateFormatPref(htmlDateFormatToPreference(stored));
  }, []);

  const salesTaxOptions = useMemo(
    () => taxCodes.filter((t) => !t.kind || t.kind === "GST_HST" || t.kind === "NONE"),
    [taxCodes],
  );
  const provinceTaxOptions = useMemo(
    () => taxCodes.filter((t) => t.kind === "PST"),
    [taxCodes],
  );
  const provinceTaxByProvince = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of taxCodes) {
      if (t.kind === "PST" && t.province) map.set(t.province.toUpperCase(), t.code);
    }
    return map;
  }, [taxCodes]);

  const filtered = useMemo(() => {
    const terms = query
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    let list = rows;
    if (terms.length) {
      list = list.filter((tx) => {
        const hay =
          `${tx.description} ${tx.accountName ?? ""} ${tx.notes ?? ""} ${tx.bankName ?? ""} ${tx.accountNumber ?? ""}`.toLowerCase();
        return terms.every((term) => hay.includes(term));
      });
    }
    if (moneySide === "in") list = list.filter((tx) => tx.moneyIn > 0);
    else if (moneySide === "out") list = list.filter((tx) => tx.moneyOut > 0);
    else if (moneySide === "both") {
      list = list.filter((tx) => tx.moneyIn > 0 && tx.moneyOut > 0);
    }
    if (sortBy !== "original") {
      const dir = sortDir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        switch (sortBy) {
          case "date":
            return a.date.localeCompare(b.date) * dir;
          case "description":
            return a.description.localeCompare(b.description) * dir;
          case "moneyIn":
            return (a.moneyIn - b.moneyIn) * dir;
          case "moneyOut":
            return (a.moneyOut - b.moneyOut) * dir;
          case "accountNumber":
            return (a.accountNumber ?? "").localeCompare(b.accountNumber ?? "") * dir;
          case "account":
            return (a.accountName ?? "").localeCompare(b.accountName ?? "") * dir;
          case "tax":
          case "net": {
            const calcA = calculateTransactionAmounts(
              {
                moneyIn: a.moneyIn,
                moneyOut: a.moneyOut,
                taxCodes: a.taxCodes,
                provinceTaxCodes: a.provinceTaxCodes,
                taxMode: a.taxMode === "EXCLUSIVE" ? "EXCLUSIVE" : "INCLUSIVE",
              },
              taxCatalog,
            );
            const calcB = calculateTransactionAmounts(
              {
                moneyIn: b.moneyIn,
                moneyOut: b.moneyOut,
                taxCodes: b.taxCodes,
                provinceTaxCodes: b.provinceTaxCodes,
                taxMode: b.taxMode === "EXCLUSIVE" ? "EXCLUSIVE" : "INCLUSIVE",
              },
              taxCatalog,
            );
            const va = sortBy === "tax" ? calcA.taxAmount : calcA.netAmount;
            const vb = sortBy === "tax" ? calcB.taxAmount : calcB.netAmount;
            return (va - vb) * dir;
          }
          case "statementType":
            return statementTypeLabel(a).localeCompare(statementTypeLabel(b)) * dir;
          case "postingAccount":
            return postingAccountLabel(a).localeCompare(postingAccountLabel(b)) * dir;
          case "province":
            return (a.province ?? "").localeCompare(b.province ?? "") * dir;
          default:
            return 0;
        }
      });
    }
    return list;
  }, [rows, query, moneySide, sortBy, sortDir, taxCatalog]);

  const summary = useMemo(
    () =>
      summarizeTransactions(
        filtered.map((tx) => ({
          moneyIn: tx.moneyIn,
          moneyOut: tx.moneyOut,
          taxCodes: tx.taxCodes,
          provinceTaxCodes: tx.provinceTaxCodes,
          taxMode:
            tx.taxMode === "EXCLUSIVE"
              ? "EXCLUSIVE"
              : ("INCLUSIVE" as const),
        })),
        taxCatalog,
      ),
    [filtered, taxCatalog],
  );

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((tx) => selected.has(tx.id));

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((tx) => next.delete(tx.id));
      else filtered.forEach((tx) => next.add(tx.id));
      return next;
    });
  }

  function toggleOne(id: string) {
    startTransition(() => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    });
  }

  function openConfirm(
    rows: PendingRows,
    label: string,
    bankHint?: {
      institutionName: string | null;
      statementType: "BANK" | "CREDIT_CARD" | null;
      accountLast4?: string | null;
      openingBalance?: number | null;
      closingBalance?: number | null;
      totalWithdrawals?: number | null;
      totalDeposits?: number | null;
      periodLabel?: string | null;
    } | null,
  ) {
    if (!rows.length) {
      toast.error("No transactions detected in this file.");
      return;
    }
    setPendingRows(rows);
    setPendingLabel(label);
    setPendingBankHint(bankHint ?? null);
    setPreviewExpanded(true);
    setPreviewSwapSides(false);
    setImportBankMode(banks.length ? "existing" : "new");
    setImportBankId(activeBankId ?? banks[0]?.id ?? "");
    setNewBankName("");
    const preferCc =
      readSidebarStatementIsCreditCard() || bankHint?.statementType === "CREDIT_CARD";
    const preferredType = preferCc ? "CREDIT_CARD" : "BANK";
    setNewBankType(preferredType);
    const typedBanks = banks.filter((b) => b.type === preferredType);
    if (typedBanks.length) {
      const activeOk = typedBanks.some((b) => b.id === (activeBankId ?? ""));
      setImportBankId(activeOk && activeBankId ? activeBankId : typedBanks[0]!.id);
      setImportBankMode("existing");
    } else {
      setImportBankMode(banks.length ? "existing" : "new");
    }
    if (bankHint?.institutionName) {
      void import("@/lib/bank-hint-match").then(({ resolveBankFromHint }) => {
        const resolved = resolveBankFromHint(banks, bankHint);
        if (!resolved) return;
        if (resolved.mode === "existing") {
          setImportBankMode("existing");
          setImportBankId(resolved.bankId);
          toast.message(`Matched bank: ${banks.find((b) => b.id === resolved.bankId)?.name ?? "existing"}`);
        } else {
          setImportBankMode("new");
          setNewBankName(resolved.name);
          setNewBankType(resolved.type);
          toast.message(`Detected from statement: ${resolved.name}`);
        }
      });
    }
    setImportOpen(true);
  }

  async function parseViaApi(file: File) {
    const body = new FormData();
    body.set("file", file);
    const res = await fetch("/api/import/parse", { method: "POST", body });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Parse failed");
    return json as {
      rows: PendingRows;
      errors?: string[];
      warnings?: string[];
      fileName: string;
      format: string;
      source?: string;
      bankHint?: {
        institutionName: string | null;
        statementType: "BANK" | "CREDIT_CARD" | null;
        accountLast4?: string | null;
        confidence?: string;
        openingBalance?: number | null;
        closingBalance?: number | null;
        totalWithdrawals?: number | null;
        totalDeposits?: number | null;
        periodLabel?: string | null;
      } | null;
    };
  }

  async function clearTransactionsForNew() {
    const result = await deleteAllTransactionsAction();
    if (result.ok) {
      clearLoadedConversionContext(organizationId);
      setRows([]);
      setSelected(new Set());
      toast.success(result.message ?? "Ready for a new import.");
      router.refresh();
    } else toast.error(result.error ?? "Could not clear");
  }

  function clearParseStatusTimer() {
    if (parseStatusTimerRef.current) {
      clearInterval(parseStatusTimerRef.current);
      parseStatusTimerRef.current = null;
    }
  }

  function startParseLoading(fileName: string) {
    clearParseStatusTimer();
    setParseLoadingFile(fileName);
    setParseLoadingStatus(`Starting ${fileName}…`);
    let tick = 0;
    const pushStatus = (msg: string) => {
      setParseLoadingStatus(msg);
      window.dispatchEvent(new CustomEvent("ledgerdesk:import-status", { detail: msg }));
    };
    pushStatus(`${SIDEBAR_PARSE_MESSAGES[0]} (${fileName})`);
    parseStatusTimerRef.current = setInterval(() => {
      tick = (tick + 1) % SIDEBAR_PARSE_MESSAGES.length;
      pushStatus(`${SIDEBAR_PARSE_MESSAGES[tick]} (${fileName})`);
    }, 2800);
  }

  function stopParseLoading(finalStatus = "Ready — choose a statement to begin.") {
    clearParseStatusTimer();
    setParseLoadingFile(null);
    setParseLoadingStatus(null);
    window.dispatchEvent(
      new CustomEvent("ledgerdesk:import-status", { detail: finalStatus }),
    );
  }

  /** Parse one statement into pending rows (auto-map spreadsheets — used for bulk). */
  async function parseFileToPending(file: File): Promise<{
    rows: PendingRows;
    bankHint?: {
      institutionName: string | null;
      statementType: "BANK" | "CREDIT_CARD" | null;
      accountLast4?: string | null;
      openingBalance?: number | null;
      closingBalance?: number | null;
      totalWithdrawals?: number | null;
      totalDeposits?: number | null;
      periodLabel?: string | null;
    } | null;
    sourceLabel: string;
  } | null> {
    const lower = file.name.toLowerCase();

    if (/\.(jpe?g|png|webp)$/i.test(lower)) {
      const { parseStatementFromImageFile } = await import("@/lib/ocr-statement-import");
      const parsed = await parseStatementFromImageFile(file);
      if (!parsed.rows.length) return null;
      return {
        rows: rowsFromParsed(parsed.rows),
        sourceLabel: `OCR: ${file.name}`,
      };
    }

    if (lower.endsWith(".pdf") || lower.endsWith(".xml") || lower.endsWith(".camt")) {
      const parsed = await parseViaApi(file);
      if (parsed.rows?.length) {
        const src = parsed.source?.startsWith("openai")
          ? `AI (${parsed.source.replace("openai-", "")})`
          : parsed.format.toUpperCase();
        return {
          rows: parsed.rows,
          bankHint: parsed.bankHint ?? null,
          sourceLabel: `${src}: ${parsed.fileName}`,
        };
      }
      if (lower.endsWith(".pdf")) {
        const { isOcrPdfFallbackEnabled } = await import("@/lib/import-preferences");
        if (isOcrPdfFallbackEnabled()) {
          const { parseStatementFromPdfFileViaOcr } = await import("@/lib/pdf-statement-import");
          const ocrParsed = await parseStatementFromPdfFileViaOcr(file);
          if (ocrParsed.rows.length) {
            return {
              rows: rowsFromParsed(ocrParsed.rows),
              sourceLabel: `OCR PDF: ${file.name}`,
            };
          }
        }
      }
      return null;
    }

    if (isOfxOrQboFileName(file.name) || lower.endsWith(".qfx")) {
      try {
        const text = await file.text();
        const parsed = lower.endsWith(".xml") ? parseBankXml(text) : parseOfxOrQbo(text);
        if (!parsed.rows.length) return null;
        return { rows: rowsFromParsed(parsed.rows), sourceLabel: file.name };
      } catch {
        const parsed = await parseViaApi(file);
        if (!parsed.rows?.length) return null;
        return { rows: parsed.rows, sourceLabel: file.name, bankHint: parsed.bankHint };
      }
    }

    const matrix = await parseImportFile(file);
    if (!matrix.headers.length || !matrix.rows.length) return null;
    const guessed = guessMapping(matrix);
    const mapping: ColumnMapping = {
      date: guessed.date ?? matrix.headers[0],
      description: guessed.description ?? matrix.headers[1] ?? matrix.headers[0],
      moneyIn: guessed.moneyIn,
      moneyOut: guessed.moneyOut,
      amount: guessed.moneyIn || guessed.moneyOut ? undefined : guessed.amount,
      txnType: guessed.txnType,
      signedRule: guessed.signedRule ?? "positiveIn",
      dateFormat: dateFormatPref !== "AUTO" ? dateFormatPref : guessed.dateFormat ?? "AUTO",
    };
    let best = mapRowsToTransactions(matrix, mapping);
    for (const fmt of (
      dateFormatPref !== "AUTO" ? [dateFormatPref] : ["MDY", "DMY", "AUTO"]
    ) as DateFormatPreference[]) {
      const attempt = mapRowsToTransactions(matrix, { ...mapping, dateFormat: fmt });
      if (attempt.rows.length > best.rows.length) {
        best = attempt;
        mapping.dateFormat = fmt;
      }
    }
    if (!best.rows.length) return null;
    return {
      rows: rowsFromParsed(best.rows),
      sourceLabel: file.name,
    };
  }

  async function onPickFiles(files: File[]) {
    const list = files.filter(Boolean);
    if (!list.length) return;
    if (list.length === 1) {
      await onPickFile(list[0]!);
      return;
    }

    startParseLoading(`${list.length} files`);
    let okStatus = "Ready — choose a statement to begin.";
    const merged: PendingRows = [];
    const labels: string[] = [];
    let bankHint: Parameters<typeof openConfirm>[2] = null;
    let failed = 0;

    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i]!;
        const progress = `Parsing ${i + 1}/${list.length}: ${file.name}…`;
        setParseLoadingStatus(progress);
        window.dispatchEvent(
          new CustomEvent("ledgerdesk:import-status", { detail: progress }),
        );
        try {
          const result = await parseFileToPending(file);
          if (!result?.rows.length) {
            failed += 1;
            toast.message(`No transactions in ${file.name}`);
            continue;
          }
          merged.push(...result.rows);
          labels.push(`${file.name} (${result.rows.length})`);
          if (!bankHint && result.bankHint) bankHint = result.bankHint;
          toast.message(`${file.name}: ${result.rows.length} row(s)`);
        } catch (err) {
          failed += 1;
          toast.error(
            `${file.name}: ${err instanceof Error ? err.message : "parse failed"}`,
          );
        }
      }

      if (!merged.length) {
        toast.error("No transactions found in the selected files.");
        okStatus = "No transactions found — try other files.";
        return;
      }

      setMatrix(null);
      setMapping(null);
      openConfirm(
        merged,
        `Bulk import · ${list.length - failed} file(s) · ${merged.length} transactions`,
        bankHint,
      );
      toast.success(
        `Merged ${merged.length} transactions from ${list.length - failed} file${list.length - failed === 1 ? "" : "s"}${failed ? ` (${failed} skipped)` : ""}.`,
      );
      okStatus = "Ready — review the preview, then import.";
    } finally {
      stopParseLoading(okStatus);
    }
  }

  async function onPickFile(file: File | null) {
    if (!file) return;
    const lower = file.name.toLowerCase();
    startParseLoading(file.name);
    let okStatus = "Ready — choose a statement to begin.";
    try {
      if (/\.(jpe?g|png|webp)$/i.test(lower)) {
        toast.message("Running OCR on image…");
        const { parseStatementFromImageFile } = await import("@/lib/ocr-statement-import");
        const parsed = await parseStatementFromImageFile(file);
        if (!parsed.rows.length) {
          toast.error(
            parsed.errors[0] ??
              "No transactions detected in this image. Try a bank CSV/Excel export or a clearer photo.",
          );
          okStatus = "No transactions found — try another file.";
          return;
        }
        if (parsed.errors.length) toast.message(parsed.errors[0]);
        openConfirm(rowsFromParsed(parsed.rows), `OCR: ${file.name}`);
        okStatus = "Ready — review the preview, then import.";
        return;
      }

      if (lower.endsWith(".pdf") || lower.endsWith(".xml") || lower.endsWith(".camt")) {
        toast.message(lower.endsWith(".pdf") ? "Reading PDF…" : "Reading file…");
        const parsed = await parseViaApi(file);
        if (!parsed.rows?.length) {
          if (lower.endsWith(".pdf")) {
            const { isOcrPdfFallbackEnabled } = await import("@/lib/import-preferences");
            if (isOcrPdfFallbackEnabled()) {
              toast.message("No rows from PDF — running browser OCR…");
              const { parseStatementFromPdfFileViaOcr } = await import(
                "@/lib/pdf-statement-import"
              );
              const ocrParsed = await parseStatementFromPdfFileViaOcr(file, (label, fraction) => {
                if (fraction >= 1) toast.message(label);
              });
              if (ocrParsed.rows.length) {
                if (ocrParsed.errors.length) toast.message(ocrParsed.errors[0]);
                openConfirm(rowsFromParsed(ocrParsed.rows), `OCR PDF: ${file.name}`);
                okStatus = "Ready — review the preview, then import.";
                return;
              }
              toast.error(
                ocrParsed.errors[0] ??
                  parsed.errors?.[0] ??
                  "No transactions found in this PDF.",
              );
              okStatus = "No transactions found — try CSV/Excel.";
              return;
            }
          }
          toast.error(
            parsed.errors?.[0] ??
              "No transactions found in this PDF. Try a text-based PDF or bank CSV/Excel export.",
          );
          okStatus = "No transactions found — try CSV/Excel.";
          return;
        }
        if (parsed.errors?.length) toast.message(parsed.errors[0]);
        if (parsed.warnings?.length) toast.message(parsed.warnings[0]);
        const src = parsed.source?.startsWith("openai")
          ? `AI (${parsed.source.replace("openai-", "")})`
          : parsed.format.toUpperCase();
        toast.success(`${src}: ${parsed.rows.length} transaction${parsed.rows.length === 1 ? "" : "s"}`);
        openConfirm(parsed.rows, `${src}: ${parsed.fileName}`, parsed.bankHint);
        okStatus = "Ready — review the preview, then import.";
        return;
      }

      if (isOfxOrQboFileName(file.name) || lower.endsWith(".qfx")) {
        try {
          const text = await file.text();
          const parsed = lower.endsWith(".xml")
            ? parseBankXml(text)
            : parseOfxOrQbo(text);
          if (parsed.errors.length) toast.message(`${parsed.errors.length} rows skipped`);
          openConfirm(rowsFromParsed(parsed.rows), file.name);
        } catch {
          const parsed = await parseViaApi(file);
          openConfirm(parsed.rows, file.name);
        }
        okStatus = "Ready — review the preview, then import.";
        return;
      }

      const parsed = await parseImportFile(file);
      if (!parsed.headers.length || !parsed.rows.length) {
        toast.error(
          "No transaction rows found. If this is a bank Excel export, make sure the sheet has Date / Description / Amount columns.",
        );
        okStatus = "No transaction rows found.";
        return;
      }
      const guessed = guessMapping(parsed);
      const initialMapping: ColumnMapping = {
        date: guessed.date ?? parsed.headers[0],
        description: guessed.description ?? parsed.headers[1] ?? parsed.headers[0],
        moneyIn: guessed.moneyIn,
        moneyOut: guessed.moneyOut,
        amount: guessed.moneyIn || guessed.moneyOut ? undefined : guessed.amount,
        txnType: guessed.txnType,
        signedRule: guessed.signedRule ?? "positiveIn",
        dateFormat: dateFormatPref !== "AUTO" ? dateFormatPref : guessed.dateFormat ?? "AUTO",
      };
      let best = mapRowsToTransactions(parsed, initialMapping);
      const formatCandidates: DateFormatPreference[] =
        dateFormatPref !== "AUTO"
          ? [dateFormatPref]
          : ["MDY", "DMY", "AUTO"];
      for (const fmt of formatCandidates) {
        const attempt = mapRowsToTransactions(parsed, {
          ...initialMapping,
          dateFormat: fmt,
        });
        if (attempt.rows.length > best.rows.length) {
          best = attempt;
          initialMapping.dateFormat = fmt;
        }
      }
      if (!best.rows.length && initialMapping.amount == null) {
        for (const header of parsed.headers) {
          const attempt = mapRowsToTransactions(parsed, {
            ...initialMapping,
            moneyIn: undefined,
            moneyOut: undefined,
            amount: header,
          });
          if (attempt.rows.length > best.rows.length) {
            best = attempt;
            initialMapping.moneyIn = undefined;
            initialMapping.moneyOut = undefined;
            initialMapping.amount = header;
          }
        }
      }
      setMatrix(parsed);
      setMapping(initialMapping);
      setPendingRows(null);
      setPendingLabel(
        parsed.headerRowIndex < 0
          ? `${file.name} (no header row — auto-detected columns)`
          : `${file.name}${parsed.headerRowIndex > 0 ? ` (header row ${parsed.headerRowIndex + 1})` : ""}`,
      );
      setImportBankMode(banks.length ? "existing" : "new");
      setImportBankId(activeBankId ?? banks[0]?.id ?? "");
      setPreviewExpanded(true);
      setImportOpen(true);
      okStatus = "Ready — review the preview, then import.";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not parse file");
      okStatus = "Import failed — try again or use CSV/Excel.";
    } finally {
      stopParseLoading(okStatus);
    }
  }

  useEffect(() => {
    return () => clearParseStatusTimer();
  }, []);

  useEffect(() => {
    // Files stashed when user imported from another tab (e.g. GST)
    const stashed = takePendingImportFiles();
    if (stashed?.length) {
      if (rows.length > 0) {
        pendingImportFilesRef.current = stashed;
        setImportGuardMode("import");
        setImportGuardOpen(true);
      } else {
        void onPickFiles(stashed);
      }
    }
  }, []);

  useEffect(() => {
    const onImport = (e: Event) => {
      const detail = (e as CustomEvent<File | File[]>).detail;
      const files = Array.isArray(detail)
        ? detail.filter((f): f is File => f instanceof File)
        : detail instanceof File
          ? [detail]
          : [];
      if (!files.length) return;
      if (rows.length > 0) {
        pendingImportFilesRef.current = files;
        setImportGuardMode("import");
        setImportGuardOpen(true);
        return;
      }
      void onPickFiles(files);
    };
    const onSave = () => setSaveOpen(true);
    const onNew = () => {
      if (!canEdit) {
        toast.error("You cannot start a new conversion.");
        return;
      }
      if (rows.length > 0) {
        pendingImportFilesRef.current = null;
        setImportGuardMode("new");
        setImportGuardOpen(true);
        return;
      }
      void clearTransactionsForNew();
    };
    const onAddRow = () => toast.message("+ Add Blank Row will create a manual transaction soon.");
    const onDateFormat = (e: Event) => {
      const fmt = (e as CustomEvent<string>).detail;
      if (typeof fmt === "string" && fmt) {
        setDateFormatPref(htmlDateFormatToPreference(fmt));
        toast.success(`Date format set to ${fmt}`);
      }
    };

    window.addEventListener(CONVERTER_EVENTS.importStatement, onImport);
    window.addEventListener(CONVERTER_EVENTS.openSaveConversion, onSave);
    window.addEventListener(CONVERTER_EVENTS.newConversion, onNew);
    window.addEventListener(CONVERTER_EVENTS.addBlankRow, onAddRow);
    window.addEventListener(CONVERTER_EVENTS.applyDateFormat, onDateFormat);
    return () => {
      window.removeEventListener(CONVERTER_EVENTS.importStatement, onImport);
      window.removeEventListener(CONVERTER_EVENTS.openSaveConversion, onSave);
      window.removeEventListener(CONVERTER_EVENTS.newConversion, onNew);
      window.removeEventListener(CONVERTER_EVENTS.addBlankRow, onAddRow);
      window.removeEventListener(CONVERTER_EVENTS.applyDateFormat, onDateFormat);
    };
  }, [canEdit, rows.length, router, bankName]);

  function buildBankPayload() {
    if (importBankMode === "new") {
      return {
        newBankName: newBankName.trim() || "Imported Statements",
        newBankType,
      };
    }
    return {
      bankAccountId: importBankId || undefined,
    };
  }

  const importStatementType = useMemo((): "BANK" | "CREDIT_CARD" => {
    if (importBankMode === "new") return newBankType;
    return banks.find((b) => b.id === importBankId)?.type ?? newBankType;
  }, [importBankMode, newBankType, banks, importBankId]);

  /** Preview + import rows after optional manual Debit/Credit swap. */
  const previewPendingRows = useMemo(() => {
    if (!pendingRows) return null;
    return previewSwapSides ? swapMoneySides(pendingRows) : pendingRows;
  }, [pendingRows, previewSwapSides]);

  function setImportStatementType(type: "BANK" | "CREDIT_CARD") {
    setNewBankType(type);
    const typed = banks.filter((b) => b.type === type);
    if (typed.length) {
      setImportBankMode("existing");
      if (!typed.some((b) => b.id === importBankId)) {
        setImportBankId(typed[0]!.id);
      }
    } else {
      setImportBankMode("new");
    }
  }

  function confirmMappedImport() {
    if (!matrix || !mapping) return;
    const { rows, errors } = mapRowsToTransactions(matrix, mapping);
    if (!rows.length) {
      const hint = errors[0]
        ? ` ${errors[0]}`
        : " Check Date / Description / Debit-Credit column mapping and date format.";
      toast.error(`No valid transactions to import.${hint}`);
      if (errors.length > 1) {
        toast.message(`${errors.length} rows could not be mapped. Try DD/MM/YYYY date format.`);
      }
      return;
    }
    if (errors.length) {
      toast.message(`Imported ${rows.length}; skipped ${errors.length} row(s).`);
    }
    const pending = rowsFromParsed(rows);
    submitImport(previewSwapSides ? swapMoneySides(pending) : pending);
  }

  function confirmDirectImport() {
    if (!previewPendingRows?.length) return;
    submitImport(previewPendingRows);
  }

  function submitImport(rows: PendingRows) {
    const payload = {
      applyRules: applyRulesOnImport,
      replaceExisting: replaceBeforeNextImportRef.current,
      rows,
      ...buildBankPayload(),
    };
    replaceBeforeNextImportRef.current = false;
    const formData = new FormData();
    formData.set("payload", JSON.stringify(payload));
    startTransition(async () => {
      const result = await importTransactionsAction(undefined, formData);
      if (result.ok) {
        toast.success(result.message ?? "Imported");
        setImportOpen(false);
        setMatrix(null);
        setMapping(null);
        setPendingRows(null);
        setPreviewSwapSides(false);
        setSelected(new Set());
      } else {
        toast.error(result.error ?? "Import failed");
      }
    });
  }

  function runApplyRules() {
    startTransition(async () => {
      const result = await applyRulesToTransactionsAction();
      if (result.ok) toast.success(result.message ?? "Rules applied");
      else toast.error(result.error ?? "Failed");
    });
  }

  const summaryCards = [
    ["Transactions", String(summary.count), ""],
    ["Money In", `$${summary.moneyIn.toFixed(2)}`, "money-in"],
    ["Money Out", `$${summary.moneyOut.toFixed(2)}`, "money-out"],
    ["Tax Amount", `$${summary.taxAmount.toFixed(2)}`, ""],
    ["Net Amount", `$${summary.netAmount.toFixed(2)}`, ""],
  ] as const;

  const taxPickerRow = taxPickerTxId ? rows.find((r) => r.id === taxPickerTxId) : null;
  const taxPickerSelected = taxPickerRow
    ? [...taxPickerRow.taxCodes, ...taxPickerRow.provinceTaxCodes]
    : [];

  function runDeleteRow(id: string) {
    const formData = new FormData();
    formData.set("ids", id);
    startTransition(async () => {
      const result = await deleteTransactionsAction(formData);
      if (result.ok) {
        toast.success(result.message ?? "Deleted");
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } else toast.error(result.error ?? "Delete failed");
    });
  }

  function runDuplicate(ids: string[]) {
    if (!ids.length) return;
    const formData = new FormData();
    formData.set("ids", ids.join(","));
    startTransition(async () => {
      const result = await duplicateTransactionsAction(formData);
      if (result.ok) toast.success(result.message ?? "Duplicated");
      else toast.error(result.error ?? "Duplicate failed");
    });
  }

  function runSwapDebitCredit() {
    const ids = selected.size ? [...selected] : filtered.map((tx) => tx.id);
    if (!ids.length) {
      toast.error("No transactions to swap.");
      return;
    }
    const idSet = new Set(ids);
    setRows((prev) =>
      prev.map((tx) =>
        idSet.has(tx.id) ? { ...tx, moneyIn: tx.moneyOut, moneyOut: tx.moneyIn } : tx,
      ),
    );
    const formData = new FormData();
    formData.set("ids", ids.join(","));
    startTransition(async () => {
      const result = await swapDebitCreditAction(formData);
      if (result.ok) {
        toast.success(result.message ?? "Swapped Money In ↔ Money Out");
        router.refresh();
      } else {
        toast.error(result.error ?? "Swap failed");
        router.refresh();
      }
    });
  }

  function applyTaxPicker(codes: string[]) {
    if (!taxPickerTxId) return;
    const sales = codes.filter((c) => {
      const t = taxCodes.find((x) => x.code === c);
      return !t?.kind || t.kind === "GST_HST" || t.kind === "NONE" || t.kind === "OTHER";
    });
    const provinceCodes = codes.filter((c) => taxCodes.find((x) => x.code === c)?.kind === "PST");
    setRows((prev) =>
      prev.map((row) =>
        row.id === taxPickerTxId
          ? { ...row, taxCodes: sales, provinceTaxCodes: provinceCodes }
          : row,
      ),
    );
    setDirtyRowIds((prev) => new Set(prev).add(taxPickerTxId));
    setTaxPickerTxId(null);
  }

  function saveAllChanges() {
    const ids = [...dirtyRowIds];
    if (!ids.length) return;
    startTransition(async () => {
      let saved = 0;
      for (const id of ids) {
        const save = rowSaversRef.current.get(id);
        if (save && (await save())) saved += 1;
      }
      if (saved > 0) {
        toast.success(`Saved ${saved} change${saved === 1 ? "" : "s"}`);
        router.refresh();
        setDirtyRowIds(new Set());
      }
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function selectMoneySide(side: "in" | "out") {
    startTransition(() => {
      setSelected(
        new Set(
          filtered
            .filter((tx) => (side === "in" ? tx.moneyIn > 0 : tx.moneyOut > 0))
            .map((tx) => tx.id),
        ),
      );
    });
  }

  return (
    <div className="space-y-4">
      <div className="toolbar-stack">
        <div className="toolbar">
          <div className="toolbar-left">
            {canEdit ? (
              <>
                <button type="button" className="btn-converter btn-green" id="addRowBtn2">
                  + Add Row
                </button>
                <button
                  type="button"
                  className="btn-converter btn-light"
                  id="duplicateSelected"
                  onClick={() => runDuplicate([...selected])}
                  disabled={!selected.size}
                >
                  Duplicate Selected
                </button>
                <button
                  type="button"
                  className="btn-converter btn-light"
                  id="swapDebitCreditBtn"
                  disabled={pending || (!selected.size && !filtered.length)}
                  onClick={runSwapDebitCredit}
                  title={
                    selected.size
                      ? `Swap Money In ↔ Money Out on ${selected.size} selected`
                      : "Swap Money In ↔ Money Out on all visible transactions"
                  }
                >
                  ⇄ Swap Debit / Credit
                </button>
                <button
                  type="button"
                  className="btn-converter btn-light"
                  id="applyRulesBtn"
                  disabled={pending}
                  onClick={runApplyRules}
                >
                  Apply Rules
                </button>
                <button
                  type="button"
                  className="btn-converter btn-light"
                  id="selectMoneyInBtn"
                  onClick={() => selectMoneySide("in")}
                >
                  Select Money In
                </button>
                <button
                  type="button"
                  className="btn-converter btn-light"
                  id="selectMoneyOutBtn"
                  onClick={() => selectMoneySide("out")}
                >
                  Select Money Out
                </button>
              </>
            ) : null}
          </div>
          <div className="toolbar-right">
          <div className="toolbar-sort">
            <label htmlFor="transactionMoneySide">Show</label>
            <select
              id="transactionMoneySide"
              value={moneySide}
              onChange={(e) => setMoneySide(e.target.value as typeof moneySide)}
            >
              <option value="all">All Transactions</option>
              <option value="in">Money In Only</option>
              <option value="out">Money Out Only</option>
              <option value="both">Money In &amp; Money Out</option>
            </select>
          </div>
          <div className="toolbar-sort">
            <label htmlFor="transactionSortBy">Sort By</label>
            <select id="transactionSortBy" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="original">Original Order</option>
              <option value="date">Date</option>
              <option value="description">Description</option>
              <option value="moneyIn">Money In</option>
              <option value="moneyOut">Money Out</option>
              <option value="accountNumber">Account Number</option>
              <option value="account">Account / Category</option>
              <option value="tax">Tax Amount</option>
              <option value="net">Net Amount</option>
              <option value="statementType">Bank / Credit Card</option>
              <option value="postingAccount">Posting Account</option>
              <option value="province">Province</option>
            </select>
            <select
              id="transactionSortDirection"
              className="sort-dir"
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
              aria-label="Transaction sort direction"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
          <input
            id="searchBox"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search description/account... Use commas for multiple terms"
            style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 9, minWidth: 240 }}
          />
          </div>
        </div>

        {canEdit ? (
          <div className="toolbar toolbar-secondary">
            <div className="toolbar-secondary-row">
              <button
                type="button"
                className={`btn-converter ${dirtyRowIds.size ? "btn-green" : "btn-light"}`}
                id="saveChangesBtn"
                disabled={!dirtyRowIds.size || pending}
                onClick={saveAllChanges}
              >
                Save Changes
                {dirtyRowIds.size ? ` (${dirtyRowIds.size})` : ""}
              </button>
              {selected.size > 0 ? (
                <>
                  <button
                    type="button"
                    className="btn-converter btn-light"
                    id="deleteSelected"
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    Delete Selected
                  </button>
                  <button
                    type="button"
                    className="btn-converter btn-light"
                    id="bulkEditBtn"
                    onClick={() => setBulkEditOpen(true)}
                  >
                    Bulk Edit
                  </button>
                  <button
                    type="button"
                    className="btn-converter btn-light"
                    id="clearAll"
                    onClick={clearSelection}
                  >
                    Clear All
                  </button>
                  <span
                    className="selected-count-pill has-selection toolbar-selected-count"
                    id="selectedTransactionCount"
                  >
                    {selected.size} selected
                  </span>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="summary">
        {summaryCards.map(([label, value, tone]) => (
          <div key={label} className="card">
            <div className="k">{label}</div>
            <div className={`v ${tone}`} id={label === "Transactions" ? "sumRows" : label === "Money In" ? "sumIn" : label === "Money Out" ? "sumOut" : label === "Tax Amount" ? "sumTax" : "sumNet"}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <DualScrollArea className="table-wrap">
        <table className="tx-table">
          <thead>
            <tr>
              {canEdit ? (
                <th className="col-check">
                  <input
                    type="checkbox"
                    id="selectAll"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label="Select all visible"
                  />
                </th>
              ) : null}
              <th className="col-idx">#</th>
              <th className="col-stmt">Bank / Credit Card</th>
              <th className="col-posting">Posting Account</th>
              <th className="col-date">Date</th>
              <th className="col-desc">Description</th>
              <th className="num col-money">Money In</th>
              <th className="num col-money">Money Out</th>
              <th className="col-acctnum">Account Number</th>
              <th className="col-acct">Category / Account</th>
              <th className="col-province">Province</th>
              <th className="col-tax">Sales Tax</th>
              <th className="col-taxmode">Tax Treatment</th>
              <th className="num col-amt">Tax Amount</th>
              <th
                className="num col-amt"
                title="Transaction amount excluding the selected sales tax"
              >
                Net Amount
              </th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="txBody">
            {filtered.map((tx, rowIndex) => (
              <EditableTransactionRow
                key={tx.id}
                tx={tx}
                rowIndex={rowIndex}
                canEdit={canEdit}
                selected={selected.has(tx.id)}
                onToggle={() => toggleOne(tx.id)}
                onPatched={handlePatched}
                onDirtyChange={handleDirtyChange}
                registerRowSaver={registerRowSaver}
                unregisterRowSaver={unregisterRowSaver}
                onOpenTaxPicker={() => setTaxPickerTxId(tx.id)}
                onCopyRow={() => runDuplicate([tx.id])}
                onDeleteRow={() => runDeleteRow(tx.id)}
                accounts={accounts}
                banks={banks}
                taxCatalog={taxCatalog}
                provinceTaxByProvince={provinceTaxByProvince}
              />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 ? (
          <div className="empty" id="emptyState">
            <h3>No transactions yet</h3>
            <div>Import a bank or credit card statement, or add a blank row.</div>
          </div>
        ) : null}
      </DualScrollArea>

      <TransactionTaxPickerModal
        open={!!taxPickerTxId}
        taxOptions={taxCodes.map((t) => ({
          code: t.code,
          name: t.name,
          rate: t.rate,
          kind: t.kind,
        }))}
        selectedCodes={taxPickerSelected}
        onClose={() => setTaxPickerTxId(null)}
        onApply={applyTaxPicker}
      />

      <ImportGuardModal
        open={importGuardOpen}
        transactionCount={rows.length}
        title={
          importGuardMode === "new" ? "Start new conversion?" : "Import new statement?"
        }
        discardLabel={
          importGuardMode === "new" ? "Clear transactions" : "Clear & import new"
        }
        onCancel={() => {
          setImportGuardOpen(false);
          pendingImportFilesRef.current = null;
        }}
        onSaveFirst={() => {
          setImportGuardOpen(false);
          setSaveOpen(true);
          toast.message("After saving, choose your statement file(s) again to import.");
        }}
        onDiscardAndContinue={() => {
          setImportGuardOpen(false);
          const files = pendingImportFilesRef.current;
          pendingImportFilesRef.current = null;
          void (async () => {
            replaceBeforeNextImportRef.current = importGuardMode === "import";
            await clearTransactionsForNew();
            if (importGuardMode === "import" && files?.length) {
              await onPickFiles(files);
            }
          })();
        }}
      />

      <SaveConversionDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        folders={folders}
        organizationId={organizationId}
        activeBankId={activeBankId}
        transactionCount={rows.length}
        initialLoadedContext={initialLoadedConversion}
      />

      <BulkEditTransactionsModal
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        selectedIds={Array.from(selected)}
        totalCount={rows.length}
        banks={banks}
        accounts={accounts}
        taxCodes={taxCodes}
        taxCatalog={taxCatalog}
      />

      <BulkDeleteTransactionsModal
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        selectedIds={Array.from(selected)}
        onDeleted={() => setSelected(new Set())}
      />

      {parseLoadingFile ? (
        <ImportParseLoading fileName={parseLoadingFile} statusLine={parseLoadingStatus} />
      ) : null}

      {importOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <Card className="max-h-[90vh] w-full max-w-4xl overflow-auto p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">
                  {matrix ? "Map imported columns" : "Confirm import"}
                </h2>
                <p className="text-sm text-slate-500">{pendingLabel}</p>
              </div>
              <Button type="button" variant="ghost" onClick={() => setImportOpen(false)}>
                Close
              </Button>
            </div>

            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="mb-3 text-sm font-semibold text-slate-700">Destination account</p>
              {newBankName && importBankMode === "new" ? (
                <p className="mb-2 text-xs text-slate-500">
                  Prefill from statement — edit the name if needed before importing.
                </p>
              ) : null}
              <Label>Statement type</Label>
              <div
                className="mt-1.5 flex flex-wrap gap-3"
                role="radiogroup"
                aria-label="Statement type"
              >
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium has-[:checked]:border-teal-600 has-[:checked]:bg-teal-50">
                  <input
                    type="radio"
                    name="importStatementType"
                    checked={importStatementType === "BANK"}
                    onChange={() => setImportStatementType("BANK")}
                    className="accent-teal-700"
                  />
                  Bank
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium has-[:checked]:border-teal-600 has-[:checked]:bg-teal-50">
                  <input
                    type="radio"
                    name="importStatementType"
                    checked={importStatementType === "CREDIT_CARD"}
                    onChange={() => setImportStatementType("CREDIT_CARD")}
                    className="accent-teal-700"
                  />
                  Credit Card
                </label>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                Deposit / Credit → Money In · Withdrawal / Debit → Money Out
                {importStatementType === "CREDIT_CARD"
                  ? " (purchases = Money Out, payments = Money In)."
                  : "."}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={importBankMode === "existing"}
                    disabled={!banks.filter((b) => b.type === importStatementType).length}
                    onChange={() => {
                      setImportBankMode("existing");
                      const typed = banks.filter((b) => b.type === importStatementType);
                      if (typed[0]) setImportBankId(typed[0].id);
                    }}
                  />
                  Existing account
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={importBankMode === "new"}
                    onChange={() => setImportBankMode("new")}
                  />
                  Create new account
                </label>
              </div>
              {importBankMode === "existing" ? (
                <Select
                  className="mt-3"
                  value={importBankId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setImportBankId(id);
                    const bank = banks.find((b) => b.id === id);
                    if (bank) setNewBankType(bank.type);
                  }}
                >
                  {banks
                    .filter((b) => b.type === importStatementType)
                    .map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.name} ({bank.type === "BANK" ? "Bank" : "Credit Card"})
                      </option>
                    ))}
                </Select>
              ) : (
                <div className="mt-3">
                  <Label>New account name</Label>
                  <Input
                    value={newBankName}
                    onChange={(e) => setNewBankName(e.target.value)}
                    placeholder={
                      importStatementType === "CREDIT_CARD"
                        ? "Visa / Mastercard"
                        : "RBC Chequing / Imported Statements"
                    }
                  />
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setPreviewSwapSides((v) => !v)}
                >
                  {previewSwapSides ? "↺ Undo Swap Debit / Credit" : "⇄ Swap Debit / Credit"}
                </Button>
                {previewSwapSides ? (
                  <span className="text-xs font-medium text-teal-800">
                    Money In ↔ Money Out flipped for this import
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">
                    Use if deposits/withdrawals landed on the wrong side
                  </span>
                )}
              </div>
            </div>

            {matrix && mapping ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  {(
                    [
                      ["date", "Date"],
                      ["description", "Description"],
                      ["moneyIn", "Money In / Deposit (Credit)"],
                      ["moneyOut", "Money Out / Withdrawal (Debit)"],
                      ["amount", "Signed / Amount column"],
                      ["txnType", "Txn type (Withdrawal/Deposit)"],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key}>
                      <Label>{label}</Label>
                      <Select
                        value={(mapping[key] as string | undefined) ?? ""}
                        onChange={(e) =>
                          setMapping((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  [key]: e.target.value || undefined,
                                }
                              : prev,
                          )
                        }
                      >
                        <option value="">— None —</option>
                        {matrix.headers.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ))}
                  <div>
                    <Label>Date format</Label>
                    <Select
                      value={mapping.dateFormat ?? "AUTO"}
                      onChange={(e) =>
                        setMapping((prev) =>
                          prev
                            ? {
                                ...prev,
                                dateFormat: e.target.value as DateFormatPreference,
                              }
                            : prev,
                        )
                      }
                    >
                      <option value="AUTO">Auto (Canada DD/MM preferred)</option>
                      <option value="DMY">DD/MM/YYYY</option>
                      <option value="MDY">MM/DD/YYYY</option>
                      <option value="YMD">YYYY-MM-DD</option>
                    </Select>
                  </div>
                  <div>
                    <Label>Signed amount rule</Label>
                    <Select
                      value={mapping.signedRule ?? "positiveIn"}
                      onChange={(e) =>
                        setMapping((prev) =>
                          prev
                            ? {
                                ...prev,
                                signedRule: e.target.value as "positiveIn" | "positiveOut",
                              }
                            : prev,
                        )
                      }
                    >
                      <option value="positiveIn">Positive = Money In</option>
                      <option value="positiveOut">Positive = Money Out</option>
                    </Select>
                  </div>
                </div>
                {(() => {
                  const preview = mapRowsToTransactions(matrix, mapping);
                  const previewRows = previewSwapSides
                    ? swapMoneySides(preview.rows)
                    : preview.rows;
                  const maskedSample = previewRows
                    .slice(0, 8)
                    .filter((r) => /\*{2,}/.test(r.description)).length;
                  return (
                    <>
                      <p className="mt-3 text-sm text-slate-600">
                        Preview:{" "}
                        <span className="font-semibold text-teal-800">
                          {previewRows.length} valid
                        </span>
                        {preview.errors.length ? (
                          <span className="text-rose-700">
                            {" "}
                            · {preview.errors.length} skipped ({preview.errors[0]})
                          </span>
                        ) : null}
                        {previewSwapSides ? (
                          <span className="text-teal-800"> · Debit/Credit swapped</span>
                        ) : null}
                      </p>
                      {maskedSample > 0 ? (
                        <p className="mt-2 text-sm text-amber-800">
                          Some descriptions look bank-masked (***). If your file has a longer memo or
                          details column, map it under <strong>Description</strong> above — not only
                          Payee/Name.
                        </p>
                      ) : null}
                      <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="px-3 py-2 whitespace-nowrap">Date</th>
                              <th className="px-3 py-2 min-w-[280px]">Description (imported)</th>
                              <th className="px-3 py-2 whitespace-nowrap">Money In</th>
                              <th className="px-3 py-2 whitespace-nowrap">Money Out</th>
                            </tr>
                          </thead>
                          <tbody>
                            {previewRows.slice(0, 8).map((row, idx) => (
                              <tr key={idx} className="border-t border-slate-100">
                                <td className="px-3 py-2 whitespace-nowrap">
                                  {row.date.toISOString().slice(0, 10)}
                                </td>
                                <td className="px-3 py-2">{row.description}</td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  {row.moneyIn ? row.moneyIn.toFixed(2) : ""}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  {row.moneyOut ? row.moneyOut.toFixed(2) : ""}
                                </td>
                              </tr>
                            ))}
                            {!previewRows.length ? (
                              <tr>
                                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                                  No valid rows with current column mapping.
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                      <details className="mt-3 text-xs text-slate-500">
                        <summary className="cursor-pointer font-semibold text-slate-600">
                          Raw file columns (first 5 rows)
                        </summary>
                        <div className="mt-2 overflow-auto rounded-lg border border-slate-200">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50">
                              <tr>
                                {matrix.headers.map((header) => (
                                  <th key={header} className="px-2 py-1 whitespace-nowrap">
                                    {header}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {matrix.rows.slice(0, 5).map((row, idx) => (
                                <tr key={idx} className="border-t border-slate-100">
                                  {row.map((cell, cellIdx) => (
                                    <td key={cellIdx} className="px-2 py-1 whitespace-nowrap">
                                      {cell}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </>
                  );
                })()}
              </>
            ) : (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-slate-600">
                    Ready to import <strong>{previewPendingRows?.length ?? 0}</strong> detected
                    transactions.
                  </p>
                  <button
                    type="button"
                    className="text-sm font-semibold text-teal-800 hover:underline"
                    onClick={() => setPreviewExpanded((v) => !v)}
                  >
                    {previewExpanded ? "Hide preview" : "Show preview"}
                  </button>
                </div>
                {previewSwapSides ? (
                  <p className="mt-2 text-sm text-teal-800">
                    Debit/Credit swapped for this import — Deposit → Money In, Withdrawal → Money
                    Out (after flip).
                  </p>
                ) : null}
                {pendingBankHint?.periodLabel ||
                pendingBankHint?.openingBalance != null ||
                pendingBankHint?.closingBalance != null ? (
                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    {pendingBankHint.periodLabel ? (
                      <p className="font-semibold text-slate-700">{pendingBankHint.periodLabel}</p>
                    ) : null}
                    <p className="mt-1">
                      {pendingBankHint.openingBalance != null
                        ? `Opening $${pendingBankHint.openingBalance.toFixed(2)}`
                        : null}
                      {pendingBankHint.openingBalance != null &&
                      pendingBankHint.closingBalance != null
                        ? " · "
                        : null}
                      {pendingBankHint.closingBalance != null
                        ? `Closing $${pendingBankHint.closingBalance.toFixed(2)}`
                        : null}
                    </p>
                    {(pendingBankHint.totalWithdrawals != null ||
                      pendingBankHint.totalDeposits != null) && (
                      <p className="mt-0.5">
                        Statement totals — Withdrawals $
                        {(pendingBankHint.totalWithdrawals ?? 0).toFixed(2)}
                        {" · "}Deposits $
                        {(pendingBankHint.totalDeposits ?? 0).toFixed(2)}
                      </p>
                    )}
                  </div>
                ) : null}
                {previewPendingRows && previewPendingRows.length > 0 ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Money in $
                    {previewPendingRows.reduce((s, r) => s + (r.moneyIn || 0), 0).toFixed(2)}
                    {" · "}
                    money out $
                    {previewPendingRows.reduce((s, r) => s + (r.moneyOut || 0), 0).toFixed(2)}
                    {" · "}
                    deposits {previewPendingRows.filter((r) => r.moneyIn > 0).length}
                    {" / "}
                    withdrawals {previewPendingRows.filter((r) => r.moneyOut > 0).length}
                  </p>
                ) : null}
                {previewExpanded && previewPendingRows?.length ? (
                  <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 w-10">#</th>
                          <th className="px-3 py-2 whitespace-nowrap">Date</th>
                          <th className="px-3 py-2 min-w-[220px]">Description</th>
                          <th className="px-3 py-2 whitespace-nowrap text-right">Money In</th>
                          <th className="px-3 py-2 whitespace-nowrap text-right">Money Out</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewPendingRows.map((row, idx) => (
                          <tr key={`${row.date}-${idx}`} className="border-t border-slate-100">
                            <td className="px-3 py-1.5 text-slate-400">{idx + 1}</td>
                            <td className="px-3 py-1.5 whitespace-nowrap">
                              {row.date.slice(0, 10)}
                            </td>
                            <td className="px-3 py-1.5">{row.description}</td>
                            <td className="px-3 py-1.5 whitespace-nowrap text-right text-emerald-700">
                              {row.moneyIn ? row.moneyIn.toFixed(2) : ""}
                            </td>
                            <td className="px-3 py-1.5 whitespace-nowrap text-right text-rose-700">
                              {row.moneyOut ? row.moneyOut.toFixed(2) : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            )}

            <label className="mt-4 flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={applyRulesOnImport}
                onChange={(e) => setApplyRulesOnImport(e.target.checked)}
              />
              Auto-apply this organization&apos;s active rules on import
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setImportOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={pending}
                onClick={matrix ? confirmMappedImport : confirmDirectImport}
              >
                {pending ? "Importing…" : "Import transactions"}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
