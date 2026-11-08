"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addReconciliationTransactionAction,
  bulkDeleteReconciliationsAction,
  deleteReconciliationAction,
  saveReconciliationAction,
  undoReconciliationAction,
} from "@/app/actions/accounting";
import { deleteTransactionsAction } from "@/app/actions/books";
import { updateTransactionCategoryAction } from "@/app/actions/saves";
import { DualScrollArea } from "@/components/dual-scroll-area";
import { Badge, Button, Card, Input, Label } from "@/components/ui";
import {
  downloadCsv,
  downloadExcelAoa,
  exportAmountNumber,
  formatExportAmount,
  rowsToCsv,
  sanitizeExportText,
} from "@/lib/table-export";
import { jsPDF } from "jspdf";

type Tx = {
  id: string;
  date: string;
  description: string;
  moneyIn: number;
  moneyOut: number;
  accountNumber: string | null;
  accountName: string | null;
  reconciledIn: boolean;
  reconciledOut: boolean;
};

type AccountOption = { number: string; name: string };

type HistoryItem = {
  id: string;
  status: "DRAFT" | "FINISHED" | "UNDONE";
  endDate: string;
  openingBalance: number;
  statementEndingBalance: number;
  calculatedEndingBalance: number;
  difference: number;
  clearedCount: number;
  savedAt: string;
};

type Draft = {
  date: string;
  description: string;
  accountNumber: string;
  accountName: string;
  moneyIn: string;
  moneyOut: string;
};

function toDraft(tx: Tx): Draft {
  return {
    date: tx.date,
    description: tx.description,
    accountNumber: tx.accountNumber ?? "",
    accountName: tx.accountName ?? "",
    moneyIn: tx.moneyIn ? String(tx.moneyIn) : "",
    moneyOut: tx.moneyOut ? String(tx.moneyOut) : "",
  };
}

function accountPickValue(number: string, name: string) {
  if (!number.trim() && !name.trim()) return "";
  return `${number.trim()}||${name.trim()}`;
}

export function ReconciliationWorkspace({
  bankName,
  bankType,
  transactions,
  accounts = [],
  history,
  suggestedOpening,
  canEdit,
}: {
  bankName: string | null;
  bankType: "BANK" | "CREDIT_CARD" | null;
  transactions: Tx[];
  accounts?: AccountOption[];
  history: HistoryItem[];
  suggestedOpening: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [opening, setOpening] = useState(String(suggestedOpening));
  const [ending, setEnding] = useState("0");
  const [showReconciled, setShowReconciled] = useState(false);
  const [clearedIn, setClearedIn] = useState<Set<string>>(new Set());
  const [clearedOut, setClearedOut] = useState<Set<string>>(new Set());
  const [historySelected, setHistorySelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Tx[]>(transactions);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(transactions.map((tx) => [tx.id, toDraft(tx)])),
  );
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setRows(transactions);
    setDrafts(Object.fromEntries(transactions.map((tx) => [tx.id, toDraft(tx)])));
    const live = new Set(transactions.map((t) => t.id));
    setClearedIn((prev) => new Set([...prev].filter((id) => live.has(id))));
    setClearedOut((prev) => new Set([...prev].filter((id) => live.has(id))));
  }, [transactions]);

  useEffect(() => {
    setOpening(String(suggestedOpening));
  }, [suggestedOpening]);

  const visible = useMemo(() => {
    const terms = query
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    return rows.filter((tx) => {
      if (tx.date > endDate) return false;
      if (!showReconciled && (tx.reconciledIn || tx.reconciledOut)) {
        if (tx.moneyIn > 0 && tx.reconciledIn && tx.moneyOut === 0) return false;
        if (tx.moneyOut > 0 && tx.reconciledOut && tx.moneyIn === 0) return false;
      }
      if (!terms.length) return true;
      const hay = `${tx.description} ${tx.accountName ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [rows, endDate, showReconciled, query]);

  const clearableInIds = useMemo(
    () =>
      visible
        .filter((tx) => {
          const d = drafts[tx.id];
          const moneyIn = d ? Number(d.moneyIn) || 0 : tx.moneyIn;
          const moneyOut = d ? Number(d.moneyOut) || 0 : tx.moneyOut;
          if (moneyIn <= 0 && moneyOut <= 0) return !tx.reconciledIn && !tx.reconciledOut;
          return moneyIn > 0 && !tx.reconciledIn;
        })
        .map((tx) => tx.id),
    [visible, drafts],
  );
  const clearableOutIds = useMemo(
    () =>
      visible
        .filter((tx) => {
          const d = drafts[tx.id];
          const moneyIn = d ? Number(d.moneyIn) || 0 : tx.moneyIn;
          const moneyOut = d ? Number(d.moneyOut) || 0 : tx.moneyOut;
          if (moneyIn <= 0 && moneyOut <= 0) return !tx.reconciledIn && !tx.reconciledOut;
          return moneyOut > 0 && !tx.reconciledOut;
        })
        .map((tx) => tx.id),
    [visible, drafts],
  );

  const allInSelected =
    clearableInIds.length > 0 && clearableInIds.every((id) => clearedIn.has(id));
  const allOutSelected =
    clearableOutIds.length > 0 && clearableOutIds.every((id) => clearedOut.has(id));
  const allRowsSelected =
    (clearableInIds.length > 0 || clearableOutIds.length > 0) &&
    clearableInIds.every((id) => clearedIn.has(id)) &&
    clearableOutIds.every((id) => clearedOut.has(id));

  const selectedTxIds = useMemo(
    () => new Set([...clearedIn, ...clearedOut]),
    [clearedIn, clearedOut],
  );

  const deletableHistory = history.filter((h) => h.status !== "FINISHED");
  const allHistorySelected =
    deletableHistory.length > 0 &&
    deletableHistory.every((h) => historySelected.has(h.id));

  const clearedInTotal = visible
    .filter((tx) => clearedIn.has(tx.id))
    .reduce((s, tx) => s + tx.moneyIn, 0);
  const clearedOutTotal = visible
    .filter((tx) => clearedOut.has(tx.id))
    .reduce((s, tx) => s + tx.moneyOut, 0);
  const openingNum = Number(opening) || 0;
  const endingNum = Number(ending) || 0;
  const calculated =
    bankType === "CREDIT_CARD"
      ? openingNum + clearedOutTotal - clearedInTotal
      : openingNum + clearedInTotal - clearedOutTotal;
  const difference = endingNum - calculated;

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? toDraft(rows.find((r) => r.id === id)!)), ...patch },
    }));
  }

  function persistRow(id: string, override?: Partial<Draft>) {
    const base = drafts[id] ?? toDraft(rows.find((r) => r.id === id)!);
    const d = { ...base, ...override };
    const formData = new FormData();
    formData.set("id", id);
    formData.set("inline", "true");
    formData.set("date", d.date);
    formData.set("description", d.description);
    formData.set("accountNumber", d.accountNumber);
    formData.set("account", accountPickValue(d.accountNumber, d.accountName));
    formData.set("moneyIn", d.moneyIn || "0");
    formData.set("moneyOut", d.moneyOut || "0");

    startTransition(async () => {
      const result = await updateTransactionCategoryAction(undefined, formData);
      if (!result.ok) {
        toast.error(result.error ?? "Save failed");
        return;
      }
      const moneyIn = Math.max(0, Number(d.moneyIn) || 0);
      const moneyOut = Math.max(0, Number(d.moneyOut) || 0);
      setRows((prev) =>
        prev.map((tx) =>
          tx.id === id
            ? {
                ...tx,
                date: d.date,
                description: d.description,
                accountNumber: d.accountNumber || null,
                accountName: d.accountName || null,
                moneyIn,
                moneyOut,
              }
            : tx,
        ),
      );
      if (moneyIn <= 0) {
        setClearedIn((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
      if (moneyOut <= 0) {
        setClearedOut((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    });
  }

  function toggleIn(id: string) {
    setClearedIn((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleOut(id: string) {
    setClearedOut((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleRow(tx: Tx) {
    if (!canEdit) return;
    const draft = drafts[tx.id];
    const moneyIn = draft ? Number(draft.moneyIn) || 0 : tx.moneyIn;
    const moneyOut = draft ? Number(draft.moneyOut) || 0 : tx.moneyOut;
    const isEmpty = moneyIn <= 0 && moneyOut <= 0;

    // Empty / new rows: select for delete even with $0 amounts
    if (isEmpty) {
      const selected = clearedIn.has(tx.id) || clearedOut.has(tx.id);
      setClearedIn((prev) => {
        const next = new Set(prev);
        if (selected) next.delete(tx.id);
        else next.add(tx.id);
        return next;
      });
      setClearedOut((prev) => {
        const next = new Set(prev);
        if (selected) next.delete(tx.id);
        else next.add(tx.id);
        return next;
      });
      return;
    }

    const shouldClear =
      (moneyIn > 0 && !tx.reconciledIn && !clearedIn.has(tx.id)) ||
      (moneyOut > 0 && !tx.reconciledOut && !clearedOut.has(tx.id));
    if (moneyIn > 0 && !tx.reconciledIn) {
      setClearedIn((prev) => {
        const next = new Set(prev);
        if (shouldClear) next.add(tx.id);
        else next.delete(tx.id);
        return next;
      });
    }
    if (moneyOut > 0 && !tx.reconciledOut) {
      setClearedOut((prev) => {
        const next = new Set(prev);
        if (shouldClear) next.add(tx.id);
        else next.delete(tx.id);
        return next;
      });
    }
  }

  function rowFullyCleared(tx: Tx) {
    const draft = drafts[tx.id];
    const moneyIn = draft ? Number(draft.moneyIn) || 0 : tx.moneyIn;
    const moneyOut = draft ? Number(draft.moneyOut) || 0 : tx.moneyOut;
    if (moneyIn <= 0 && moneyOut <= 0) {
      return clearedIn.has(tx.id) || clearedOut.has(tx.id);
    }
    const inOk = moneyIn <= 0 || tx.reconciledIn || clearedIn.has(tx.id);
    const outOk = moneyOut <= 0 || tx.reconciledOut || clearedOut.has(tx.id);
    return inOk && outOk && (moneyIn > 0 || moneyOut > 0);
  }

  function toggleAllRows() {
    if (allRowsSelected) {
      setClearedIn(new Set());
      setClearedOut(new Set());
      return;
    }
    setClearedIn(new Set(clearableInIds));
    setClearedOut(new Set(clearableOutIds));
  }

  function toggleAllIn() {
    setClearedIn((prev) => {
      if (allInSelected) {
        const next = new Set(prev);
        clearableInIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...clearableInIds]);
    });
  }

  function toggleAllOut() {
    setClearedOut((prev) => {
      if (allOutSelected) {
        const next = new Set(prev);
        clearableOutIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...clearableOutIds]);
    });
  }

  function toggleHistoryOne(id: string) {
    setHistorySelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllHistory() {
    if (allHistorySelected) {
      setHistorySelected(new Set());
      return;
    }
    setHistorySelected(new Set(deletableHistory.map((h) => h.id)));
  }

  function deleteSelectedHistory() {
    if (!historySelected.size) return;
    if (!confirm(`Delete ${historySelected.size} reconciliation record(s)?`)) return;
    const fd = new FormData();
    fd.set("ids", [...historySelected].join(","));
    startTransition(async () => {
      const result = await bulkDeleteReconciliationsAction(fd);
      if (result.ok) {
        toast.success(result.message ?? "Deleted");
        setHistorySelected(new Set());
      } else toast.error(result.error ?? "Delete failed");
    });
  }

  function deleteSelectedTransactions() {
    if (!selectedTxIds.size) return;
    if (
      !confirm(
        `Delete ${selectedTxIds.size} selected transaction(s)? This removes them from the bank, not only from this reconciliation.`,
      )
    ) {
      return;
    }
    const ids = [...selectedTxIds];
    const fd = new FormData();
    fd.set("ids", ids.join(","));
    // Optimistic remove — no full page refresh
    setRows((prev) => prev.filter((tx) => !selectedTxIds.has(tx.id)));
    setDrafts((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
    setClearedIn(new Set());
    setClearedOut(new Set());
    startTransition(async () => {
      const result = await deleteTransactionsAction(fd);
      if (result.ok) {
        toast.success(result.message ?? "Deleted");
      } else {
        toast.error(result.error ?? "Delete failed");
        router.refresh();
      }
    });
  }

  function addRow() {
    const fd = new FormData();
    fd.set("date", endDate);
    fd.set("description", "New transaction");
    fd.set("moneyIn", "0");
    fd.set("moneyOut", "0");
    startTransition(async () => {
      const result = await addReconciliationTransactionAction(fd);
      if (!result.ok || !result.row) {
        toast.error(result.error ?? "Could not add row");
        return;
      }
      const row = result.row;
      setRows((prev) => [row, ...prev]);
      setDrafts((prev) => ({
        ...prev,
        [row.id]: {
          date: row.date,
          description: row.description,
          accountNumber: row.accountNumber ?? "",
          accountName: row.accountName ?? "",
          moneyIn: row.moneyIn ? String(row.moneyIn) : "",
          moneyOut: row.moneyOut ? String(row.moneyOut) : "",
        },
      }));
      toast.success("Row added");
    });
  }

  function rowStatus(tx: Tx) {
    if (tx.reconciledIn || tx.reconciledOut) return "Reconciled";
    if (clearedIn.has(tx.id) || clearedOut.has(tx.id)) return "Cleared";
    return "Open";
  }

  function flatExportRows() {
    return visible.map((tx) => {
      const draft = drafts[tx.id] ?? toDraft(tx);
      return {
        Date: draft.date,
        Description: sanitizeExportText(draft.description),
        AccountNumber: sanitizeExportText(draft.accountNumber),
        Category: sanitizeExportText(draft.accountName),
        MoneyIn: exportAmountNumber(draft.moneyIn),
        MoneyOut: exportAmountNumber(draft.moneyOut),
        Status: rowStatus(tx),
        ClearedIn: clearedIn.has(tx.id) || tx.reconciledIn ? "Y" : "",
        ClearedOut: clearedOut.has(tx.id) || tx.reconciledOut ? "Y" : "",
      };
    });
  }

  function exportCsv() {
    const rows = flatExportRows();
    if (!rows.length) {
      toast.message("There are no reconciliation rows to export.");
      return;
    }
    const csv = rowsToCsv(
      [
        "Date",
        "Description",
        "Account Number",
        "Category",
        "Money In",
        "Money Out",
        "Status",
        "Cleared In",
        "Cleared Out",
      ],
      rows.map((r) => [
        r.Date,
        r.Description,
        r.AccountNumber,
        r.Category,
        formatExportAmount(r.MoneyIn),
        formatExportAmount(r.MoneyOut),
        r.Status,
        r.ClearedIn,
        r.ClearedOut,
      ]),
    );
    const safeBank = sanitizeExportText(bankName || "bank").replace(/\s+/g, "_");
    downloadCsv(`reconciliation_${safeBank}_${endDate}.csv`, csv);
    toast.success("CSV downloaded.");
  }

  function exportExcel() {
    const rows = flatExportRows();
    if (!rows.length) {
      toast.message("There are no reconciliation rows to export.");
      return;
    }
    const safeBank = sanitizeExportText(bankName || "bank").replace(/\s+/g, "_");
    downloadExcelAoa(`reconciliation_${safeBank}_${endDate}.xlsx`, "Reconciliation", [
      [
        "Date",
        "Description",
        "Account Number",
        "Category",
        "Money In",
        "Money Out",
        "Status",
        "Cleared In",
        "Cleared Out",
      ],
      ...rows.map((r) => [
        r.Date,
        r.Description,
        r.AccountNumber,
        r.Category,
        r.MoneyIn,
        r.MoneyOut,
        r.Status,
        r.ClearedIn,
        r.ClearedOut,
      ]),
      [],
      ["Opening", exportAmountNumber(openingNum)],
      ["Cleared in", exportAmountNumber(clearedInTotal)],
      ["Cleared out", exportAmountNumber(clearedOutTotal)],
      ["Calculated", exportAmountNumber(calculated)],
      ["Statement", exportAmountNumber(endingNum)],
      ["Difference", exportAmountNumber(difference)],
    ]);
    toast.success("Excel downloaded.");
  }

  function exportPdf() {
    const rows = flatExportRows();
    if (!rows.length) {
      toast.message("There are no reconciliation rows to export.");
      return;
    }
    try {
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
      const margin = 32;
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      let y = margin;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("Reconciliation", margin, y);
      y += 16;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(
        sanitizeExportText(
          `${bankName || ""} (${bankType === "CREDIT_CARD" ? "Credit Card" : "Bank"})`,
        ),
        margin,
        y,
      );
      y += 14;
      doc.text(`Statement end date: ${endDate}`, margin, y);
      doc.text(`Rows: ${rows.length}`, 360, y);
      y += 14;
      doc.text(`Opening: ${formatExportAmount(openingNum)}`, margin, y);
      doc.text(`Cleared in: ${formatExportAmount(clearedInTotal)}`, 200, y);
      doc.text(`Cleared out: ${formatExportAmount(clearedOutTotal)}`, 360, y);
      y += 12;
      doc.text(`Calculated: ${formatExportAmount(calculated)}`, margin, y);
      doc.text(`Statement: ${formatExportAmount(endingNum)}`, 200, y);
      doc.text(`Difference: ${formatExportAmount(difference)}`, 360, y);
      y += 20;

      const cols = [
        { label: "Date", x: margin },
        { label: "Description", x: margin + 70 },
        { label: "Category", x: margin + 280 },
        { label: "Money In", x: pageW - margin - 220 },
        { label: "Money Out", x: pageW - margin - 130 },
        { label: "Status", x: pageW - margin - 40 },
      ];

      const drawHeader = () => {
        doc.setFillColor(238, 244, 248);
        doc.rect(margin, y - 10, pageW - margin * 2, 16, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        cols.forEach((c) => {
          if (c.label === "Money In" || c.label === "Money Out" || c.label === "Status") {
            doc.text(c.label, c.x, y, { align: "right" });
          } else {
            doc.text(c.label, c.x, y);
          }
        });
        y += 12;
      };

      drawHeader();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);

      for (const row of rows) {
        if (y > pageH - 40) {
          doc.addPage();
          y = margin;
          drawHeader();
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
        }
        doc.text(row.Date, cols[0]!.x, y);
        doc.text(row.Description.slice(0, 36), cols[1]!.x, y);
        doc.text((row.Category || "-").slice(0, 22), cols[2]!.x, y);
        doc.text(formatExportAmount(row.MoneyIn), cols[3]!.x, y, { align: "right" });
        doc.text(formatExportAmount(row.MoneyOut), cols[4]!.x, y, { align: "right" });
        doc.text(row.Status, cols[5]!.x, y, { align: "right" });
        y += 12;
      }

      const safeBank = sanitizeExportText(bankName || "bank").replace(/\s+/g, "_");
      doc.save(`reconciliation_${safeBank}_${endDate}.pdf`);
      toast.success("PDF downloaded.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF failed");
    }
  }

  function save(status: "DRAFT" | "FINISHED") {
    const formData = new FormData();
    formData.set("endDate", endDate);
    formData.set("openingBalance", String(openingNum));
    formData.set("statementEndingBalance", String(endingNum));
    formData.set("clearedInIds", Array.from(clearedIn).join(","));
    formData.set("clearedOutIds", Array.from(clearedOut).join(","));
    formData.set("status", status);
    startTransition(async () => {
      const result = await saveReconciliationAction(undefined, formData);
      if (result.ok) {
        toast.success(result.message ?? "Saved");
        if (status === "FINISHED") {
          setClearedIn(new Set());
          setClearedOut(new Set());
        }
        router.refresh();
      } else toast.error(result.error ?? "Failed");
    });
  }

  if (!bankName) {
    return (
      <Card className="p-10 text-center">
        <h2 className="text-lg font-semibold">Select a bank to reconcile</h2>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Reconciliation
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {bankName} ({bankType === "CREDIT_CARD" ? "Credit Card" : "Bank"}):{" "}
          {bankType === "CREDIT_CARD"
            ? "Opening + Money Out − Money In = Calculated ending"
            : "Opening + Money In − Money Out = Calculated ending"}
        </p>
      </div>

      <Card className="grid gap-3 p-4 md:grid-cols-4">
        <div>
          <Label>Statement end date</Label>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div>
          <Label>Opening balance</Label>
          <Input type="number" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} />
        </div>
        <div>
          <Label>Statement ending balance</Label>
          <Input type="number" step="0.01" value={ending} onChange={(e) => setEnding(e.target.value)} />
        </div>
        <div>
          <Label>Search</Label>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" />
        </div>
        <label className="flex items-center gap-2 text-sm md:col-span-4">
          <input
            type="checkbox"
            checked={showReconciled}
            onChange={(e) => setShowReconciled(e.target.checked)}
          />
          Show already reconciled
        </label>
      </Card>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ["Opening", openingNum],
          ["Cleared in", clearedInTotal],
          ["Cleared out", clearedOutTotal],
          ["Calculated", calculated],
          ["Statement", endingNum],
          ["Difference", difference],
        ].map(([label, value]) => (
          <Card key={String(label)} className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p
              className={`mt-1 text-xl font-semibold ${
                label === "Difference"
                  ? Math.abs(Number(value)) < 0.01
                    ? "text-teal-700"
                    : "text-rose-700"
                  : ""
              }`}
            >
              ${Number(value).toFixed(2)}
            </p>
          </Card>
        ))}
      </div>

      <div className="toolbar-left flex flex-wrap gap-2">
        <button type="button" className="btn-converter btn-light" onClick={exportCsv}>
          Download CSV
        </button>
        <button type="button" className="btn-converter btn-light" onClick={exportExcel}>
          Download Excel
        </button>
        <button type="button" className="btn-converter btn-light" onClick={exportPdf}>
          Download PDF
        </button>
      </div>

      {canEdit ? (
        <div className="toolbar-left flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-converter btn-green"
            disabled={pending}
            onClick={addRow}
          >
            + Add row
          </button>
          <button
            type="button"
            className="btn-converter btn-light"
            disabled={pending}
            onClick={() => save("DRAFT")}
          >
            Save draft
          </button>
          <button
            type="button"
            className="btn-converter btn-green"
            disabled={pending || Math.abs(difference) >= 0.01}
            onClick={() => save("FINISHED")}
          >
            Finish reconciliation
          </button>
          <button
            type="button"
            className="btn-converter btn-light"
            onClick={() => {
              setClearedIn(new Set());
              setClearedOut(new Set());
            }}
          >
            Clear checks
          </button>
          {selectedTxIds.size > 0 ? (
            <>
              <button
                type="button"
                className="btn-converter btn-danger"
                disabled={pending}
                onClick={deleteSelectedTransactions}
              >
                Delete selected ({selectedTxIds.size})
              </button>
              <span className="selected-count-pill has-selection">
                {selectedTxIds.size} selected
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      <DualScrollArea className="card-table">
        <table className="recon-table">
          <thead>
            <tr>
              {canEdit ? (
                <th className="col-check">
                  <input
                    type="checkbox"
                    id="selectAllReconRows"
                    checked={allRowsSelected}
                    disabled={!clearableInIds.length && !clearableOutIds.length}
                    onChange={toggleAllRows}
                    aria-label="Select all visible transactions"
                    title="Select all visible (then Delete selected)"
                  />
                </th>
              ) : null}
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th className="recon-money">
                {canEdit ? (
                  <div className="recon-money-head">
                    <input
                      type="checkbox"
                      checked={allInSelected}
                      disabled={!clearableInIds.length}
                      onChange={toggleAllIn}
                      aria-label="Select all Money In"
                      title="Select all Money In"
                    />
                    <span>Money In</span>
                  </div>
                ) : (
                  "Money In"
                )}
              </th>
              <th className="recon-money">
                {canEdit ? (
                  <div className="recon-money-head">
                    <input
                      type="checkbox"
                      checked={allOutSelected}
                      disabled={!clearableOutIds.length}
                      onChange={toggleAllOut}
                      aria-label="Select all Money Out"
                      title="Select all Money Out"
                    />
                    <span>Money Out</span>
                  </div>
                ) : (
                  "Money Out"
                )}
              </th>
              <th>Status</th>
              {canEdit ? <th className="row-actions">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {visible.map((tx) => {
              const draft = drafts[tx.id] ?? toDraft(tx);
              const rowChecked = rowFullyCleared(tx);
              const moneyInNum = Number(draft.moneyIn) || 0;
              const moneyOutNum = Number(draft.moneyOut) || 0;
              const isEmptyRow = moneyInNum <= 0 && moneyOutNum <= 0;
              const rowDisabled =
                !isEmptyRow &&
                (moneyInNum <= 0 || tx.reconciledIn) &&
                (moneyOutNum <= 0 || tx.reconciledOut);
              return (
                <tr
                  key={tx.id}
                  className={
                    clearedIn.has(tx.id) || clearedOut.has(tx.id) ? "bg-sky-50/50" : undefined
                  }
                >
                  {canEdit ? (
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={rowChecked}
                        disabled={rowDisabled}
                        onChange={() => toggleRow(tx)}
                        aria-label={`Select ${tx.description}`}
                      />
                    </td>
                  ) : null}
                  <td className="col-date">
                    {canEdit ? (
                      <input
                        type="date"
                        value={draft.date}
                        onChange={(e) => updateDraft(tx.id, { date: e.target.value })}
                        onBlur={() => persistRow(tx.id)}
                      />
                    ) : (
                      tx.date
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <input
                        type="text"
                        value={draft.description}
                        onChange={(e) => updateDraft(tx.id, { description: e.target.value })}
                        onBlur={() => persistRow(tx.id)}
                      />
                    ) : (
                      tx.description
                    )}
                  </td>
                  <td className="col-category">
                    {canEdit ? (
                      <select
                        value={accountPickValue(draft.accountNumber, draft.accountName)}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) {
                            updateDraft(tx.id, { accountNumber: "", accountName: "" });
                            persistRow(tx.id, { accountNumber: "", accountName: "" });
                            return;
                          }
                          const sep = v.indexOf("||");
                          const number = sep < 0 ? v : v.slice(0, sep);
                          const name = sep < 0 ? "" : v.slice(sep + 2);
                          updateDraft(tx.id, { accountNumber: number, accountName: name });
                          persistRow(tx.id, { accountNumber: number, accountName: name });
                        }}
                      >
                        <option value="">None</option>
                        {accounts.map((a) => (
                          <option
                            key={`${a.number}-${a.name}`}
                            value={accountPickValue(a.number, a.name)}
                          >
                            {a.number} · {a.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      tx.accountName || "—"
                    )}
                  </td>
                  <td className="recon-money">
                    <div className="recon-money-cell">
                      <input
                        type="checkbox"
                        disabled={!canEdit || tx.reconciledIn || moneyInNum <= 0}
                        checked={
                          moneyInNum > 0 && (clearedIn.has(tx.id) || tx.reconciledIn)
                        }
                        onChange={() => toggleIn(tx.id)}
                        aria-label="Clear Money In"
                      />
                      {canEdit ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="money-in"
                          value={draft.moneyIn}
                          placeholder="0.00"
                          onChange={(e) => updateDraft(tx.id, { moneyIn: e.target.value })}
                          onBlur={() => persistRow(tx.id)}
                        />
                      ) : moneyInNum > 0 ? (
                        <span className="recon-money-amount money-in">
                          ${moneyInNum.toFixed(2)}
                        </span>
                      ) : (
                        <span className="recon-money-amount" />
                      )}
                    </div>
                  </td>
                  <td className="recon-money">
                    <div className="recon-money-cell">
                      <input
                        type="checkbox"
                        disabled={!canEdit || tx.reconciledOut || moneyOutNum <= 0}
                        checked={
                          moneyOutNum > 0 && (clearedOut.has(tx.id) || tx.reconciledOut)
                        }
                        onChange={() => toggleOut(tx.id)}
                        aria-label="Clear Money Out"
                      />
                      {canEdit ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="money-out"
                          value={draft.moneyOut}
                          placeholder="0.00"
                          onChange={(e) => updateDraft(tx.id, { moneyOut: e.target.value })}
                          onBlur={() => persistRow(tx.id)}
                        />
                      ) : moneyOutNum > 0 ? (
                        <span className="recon-money-amount money-out">
                          ${moneyOutNum.toFixed(2)}
                        </span>
                      ) : (
                        <span className="recon-money-amount" />
                      )}
                    </div>
                  </td>
                  <td>
                    {tx.reconciledIn || tx.reconciledOut ? (
                      <Badge className="border-teal-200 bg-teal-50 text-teal-800">Reconciled</Badge>
                    ) : clearedIn.has(tx.id) || clearedOut.has(tx.id) ? (
                      <Badge className="border-sky-200 bg-sky-50 text-sky-800">Cleared</Badge>
                    ) : (
                      <span className="text-slate-400">Open</span>
                    )}
                  </td>
                  {canEdit ? (
                    <td className="row-actions">
                      <button
                        type="button"
                        className="btn-converter btn-danger btn-sm"
                        disabled={pending}
                        onClick={() => {
                          if (!confirm("Delete this transaction?")) return;
                          const fd = new FormData();
                          fd.set("ids", tx.id);
                          setRows((prev) => prev.filter((r) => r.id !== tx.id));
                          setClearedIn((prev) => {
                            const next = new Set(prev);
                            next.delete(tx.id);
                            return next;
                          });
                          setClearedOut((prev) => {
                            const next = new Set(prev);
                            next.delete(tx.id);
                            return next;
                          });
                          startTransition(async () => {
                            const result = await deleteTransactionsAction(fd);
                            if (result.ok) toast.success(result.message ?? "Deleted");
                            else {
                              toast.error(result.error ?? "Delete failed");
                              router.refresh();
                            }
                          });
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 8 : 6} className="px-4 py-8 text-center text-slate-500">
                  No transactions in this statement period.
                  {canEdit ? " Use + Add row to create one." : null}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </DualScrollArea>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="font-semibold">History</div>
          {canEdit && historySelected.size > 0 ? (
            <div className="toolbar-left flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-converter btn-danger btn-sm"
                disabled={pending}
                onClick={deleteSelectedHistory}
              >
                Delete Selected
              </button>
              <button
                type="button"
                className="btn-converter btn-light btn-sm"
                onClick={() => setHistorySelected(new Set())}
              >
                Clear All
              </button>
              <span className="selected-count-pill has-selection">
                {historySelected.size} selected
              </span>
            </div>
          ) : null}
        </div>
        <DualScrollArea className="card-table" style={{ border: "none", borderRadius: 0 }}>
          <table className="recon-table">
            <thead>
              <tr>
                {canEdit ? (
                  <th className="col-check">
                    <input
                      type="checkbox"
                      id="selectAllReconHistory"
                      checked={allHistorySelected}
                      disabled={!deletableHistory.length}
                      onChange={toggleAllHistory}
                      aria-label="Select all history records"
                      title="Select all deletable history"
                    />
                  </th>
                ) : null}
                <th>Status</th>
                <th>End date</th>
                <th className="text-right">Statement</th>
                <th className="text-right">Difference</th>
                <th>Selections</th>
                <th>Saved</th>
                {canEdit ? <th>Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {history.map((item) => {
                const canDelete = item.status !== "FINISHED";
                return (
                  <tr key={item.id}>
                    {canEdit ? (
                      <td className="col-check">
                        <input
                          type="checkbox"
                          checked={historySelected.has(item.id)}
                          disabled={!canDelete}
                          onChange={() => toggleHistoryOne(item.id)}
                          aria-label={`Select reconciliation ${item.endDate}`}
                          title={
                            canDelete
                              ? "Select for delete"
                              : "Undo finished reconciliation before deleting"
                          }
                        />
                      </td>
                    ) : null}
                    <td>
                      <Badge>{item.status}</Badge>
                    </td>
                    <td>{item.endDate}</td>
                    <td className="text-right">${item.statementEndingBalance.toFixed(2)}</td>
                    <td className="text-right">${item.difference.toFixed(2)}</td>
                    <td>{item.clearedCount}</td>
                    <td>{item.savedAt}</td>
                    {canEdit ? (
                      <td>
                        <div className="flex flex-wrap gap-2">
                          {item.status === "FINISHED" ? (
                            <form
                              action={async (fd) => {
                                const result = await undoReconciliationAction(fd);
                                if (result.ok) toast.success(result.message);
                                else toast.error(result.error ?? "Failed");
                              }}
                            >
                              <input type="hidden" name="id" value={item.id} />
                              <Button type="submit" size="sm" variant="secondary">
                                Undo
                              </Button>
                            </form>
                          ) : null}
                          {canDelete ? (
                            <form
                              action={async (fd) => {
                                if (!confirm("Delete this reconciliation record?")) return;
                                const result = await deleteReconciliationAction(fd);
                                if (result.ok) toast.success(result.message);
                                else toast.error(result.error ?? "Failed");
                              }}
                            >
                              <input type="hidden" name="id" value={item.id} />
                              <Button type="submit" size="sm" variant="danger">
                                Delete
                              </Button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {history.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 8 : 6} className="px-4 py-8 text-center text-slate-500">
                    No reconciliation history yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </DualScrollArea>
      </div>
    </div>
  );
}
