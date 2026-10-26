"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  bulkDeleteGeneralEntriesAction,
  createManualGeneralEntryAction,
  deleteGeneralEntryAction,
  generateGeneralEntriesAction,
  type ActionResult,
} from "@/app/actions/accounting";
import { DualScrollArea } from "@/components/dual-scroll-area";
import { Button, Card, Input, Label, Select } from "@/components/ui";
import { jsPDF } from "jspdf";

type Entry = {
  id: string;
  date: string;
  memo: string | null;
  periodLabel: string | null;
  source: "AUTOMATIC" | "MANUAL";
  debit: number;
  credit: number;
  lines: Array<{
    id: string;
    accountNumber: string | null;
    accountName: string;
    memo: string | null;
    debit: number;
    credit: number;
  }>;
};

type AccountOption = { number: string; name: string };

type ManualLine = {
  key: string;
  accountValue: string;
  memo: string;
  debit: string;
  credit: string;
};

function money(n: number) {
  return `$${n.toLocaleString("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function blankManualLine(): ManualLine {
  return {
    key: `line_${Math.random().toString(36).slice(2, 9)}`,
    accountValue: "",
    memo: "",
    debit: "",
    credit: "",
  };
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function GeneralEntriesWorkspace({
  entries,
  accounts,
  canEdit,
  fiscalYearStartMonth = 1,
  defaultInputTaxAccount = "",
  defaultOutputTaxAccount = "",
}: {
  entries: Entry[];
  accounts: AccountOption[];
  canEdit: boolean;
  fiscalYearStartMonth?: number;
  defaultInputTaxAccount?: string;
  defaultOutputTaxAccount?: string;
}) {
  const [customStartDate, setCustomStartDate] = useState(() => {
    const y = new Date().getFullYear();
    return `${y}-01-01`;
  });
  const [customEndDate, setCustomEndDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [inputTaxAccount, setInputTaxAccount] = useState(defaultInputTaxAccount);
  const [outputTaxAccount, setOutputTaxAccount] = useState(defaultOutputTaxAccount);
  const [sortBy, setSortBy] = useState<"date" | "period" | "source" | "debit" | "credit">(
    "date",
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const fiscalMonth = String(fiscalYearStartMonth || 1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingBulk, startBulk] = useTransition();
  const [showManual, setShowManual] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualMemo, setManualMemo] = useState("");
  const [manualLines, setManualLines] = useState<ManualLine[]>([
    blankManualLine(),
    blankManualLine(),
  ]);

  const [genState, genAction, genPending] = useActionState<
    ActionResult | undefined,
    FormData
  >(generateGeneralEntriesAction, undefined);
  const [manualState, manualAction, manualPending] = useActionState<
    ActionResult | undefined,
    FormData
  >(createManualGeneralEntryAction, undefined);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (genState?.ok) toast.success(genState.message);
    else if (genState?.error) toast.error(genState.error);
  }, [genState]);

  useEffect(() => {
    if (manualState?.ok) {
      toast.success(manualState.message);
      setShowManual(false);
      setManualLines([blankManualLine(), blankManualLine()]);
      setManualMemo("");
    } else if (manualState?.error) toast.error(manualState.error);
  }, [manualState]);

  const sortedEntries = useMemo(() => {
    const dir = sortDir === "desc" ? -1 : 1;
    return [...entries].sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (sortBy === "date") {
        av = a.date;
        bv = b.date;
      } else if (sortBy === "period") {
        av = a.periodLabel || "";
        bv = b.periodLabel || "";
      } else if (sortBy === "source") {
        av = a.source;
        bv = b.source;
      } else if (sortBy === "debit") {
        av = a.debit;
        bv = b.debit;
      } else {
        av = a.credit;
        bv = b.credit;
      }
      const c =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return c * dir;
    });
  }, [entries, sortBy, sortDir]);

  const autoCount = sortedEntries.filter((e) => e.source === "AUTOMATIC").length;
  const manualCount = sortedEntries.filter((e) => e.source === "MANUAL").length;
  const totalDebit = sortedEntries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = sortedEntries.reduce((s, e) => s + e.credit, 0);
  const difference = totalDebit - totalCredit;
  const balanced = Math.abs(difference) < 0.01;
  const allSelected =
    sortedEntries.length > 0 && sortedEntries.every((e) => selected.has(e.id));

  const manualTotals = useMemo(() => {
    const debit = manualLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const credit = manualLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return { debit, credit, diff: debit - credit };
  }, [manualLines]);

  const fiscalExplanation = useMemo(() => {
    if (customStartDate && customEndDate) {
      return `Automatic entries will include only transactions from ${customStartDate} through ${customEndDate} and create summarized journal entries for that range.`;
    }
    return "Choose a start date and end date to generate summarized journal entries for that range.";
  }, [customStartDate, customEndDate]);

  function toggleAll() {
    setSelected((prev) => {
      if (allSelected) return new Set();
      return new Set(sortedEntries.map((e) => e.id));
    });
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function deleteSelected() {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} general entries?`)) return;
    const fd = new FormData();
    fd.set("ids", [...selected].join(","));
    startBulk(async () => {
      const result = await bulkDeleteGeneralEntriesAction(fd);
      if (result.ok) {
        toast.success(result.message ?? "Deleted");
        setSelected(new Set());
      } else toast.error(result.error ?? "Delete failed");
    });
  }

  function flatExportRows() {
    const rows: Array<Record<string, string | number>> = [];
    sortedEntries.forEach((entry, ei) => {
      const je = `JE ${String(ei + 1).padStart(3, "0")}`;
      entry.lines.forEach((line) => {
        rows.push({
          Entry: je,
          Period: entry.periodLabel || "",
          Date: entry.date || "",
          Source: entry.source === "AUTOMATIC" ? "Automatic" : "Manual",
          AccountNumber: line.accountNumber || "",
          Account: line.accountName || "",
          Memo: line.memo || entry.memo || "",
          Debit: Number(line.debit) || 0,
          Credit: Number(line.credit) || 0,
        });
      });
    });
    return rows;
  }

  function exportCsv() {
    const rows = flatExportRows();
    if (!rows.length) {
      toast.message("There are no general entries to export.");
      return;
    }
    const heads = Object.keys(rows[0]!);
    const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [heads.map(esc).join(","), ...rows.map((r) => heads.map((h) => esc(r[h]!)).join(","))].join(
      "\r\n",
    );
    downloadBlob(
      "general_entries.csv",
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    toast.success("CSV downloaded.");
  }

  function exportExcel() {
    const rows = flatExportRows();
    if (!rows.length) {
      toast.message("There are no general entries to export.");
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "General Entries");
    XLSX.writeFile(wb, "general_entries.xlsx");
    toast.success("Excel downloaded.");
  }

  function exportPdf() {
    const rows = flatExportRows();
    if (!rows.length) {
      toast.message("There are no general entries to export.");
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
      doc.text("General Entries", margin, y);
      y += 16;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const rangeLabel =
        customStartDate && customEndDate
          ? `${customStartDate} → ${customEndDate}`
          : "All generated entries";
      doc.text(`Range: ${rangeLabel}`, margin, y);
      doc.text(`Entries: ${sortedEntries.length}`, 360, y);
      y += 14;
      doc.text(`Total Debits: ${money(totalDebit)}`, margin, y);
      doc.text(`Total Credits: ${money(totalCredit)}`, 360, y);
      y += 20;

      const cols = [
        { label: "Entry", x: margin },
        { label: "Date", x: margin + 50 },
        { label: "Period", x: margin + 110 },
        { label: "Source", x: margin + 200 },
        { label: "Account", x: margin + 270 },
        { label: "Memo", x: margin + 430 },
        { label: "Debit", x: pageW - margin - 110 },
        { label: "Credit", x: pageW - margin - 50 },
      ];

      const drawHeader = () => {
        doc.setFillColor(238, 244, 248);
        doc.rect(margin, y - 10, pageW - margin * 2, 16, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        cols.forEach((c) => doc.text(c.label, c.x, y));
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
        const account = [row.AccountNumber, row.Account].filter(Boolean).join(" — ");
        const memo = String(row.Memo || "").slice(0, 42);
        doc.text(String(row.Entry), cols[0]!.x, y);
        doc.text(String(row.Date), cols[1]!.x, y);
        doc.text(String(row.Period || "—").slice(0, 14), cols[2]!.x, y);
        doc.text(String(row.Source), cols[3]!.x, y);
        doc.text(account.slice(0, 28), cols[4]!.x, y);
        doc.text(memo, cols[5]!.x, y);
        doc.text(money(Number(row.Debit) || 0), cols[6]!.x, y, { align: "right" });
        doc.text(money(Number(row.Credit) || 0), cols[7]!.x, y, { align: "right" });
        y += 12;
      }

      const rangePart =
        customStartDate && customEndDate
          ? `_${customStartDate}_to_${customEndDate}`
          : "";
      doc.save(`general_entries${rangePart}.pdf`);
      toast.success("PDF downloaded.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF failed");
    }
  }

  function parseAccount(value: string) {
    const [number, ...rest] = value.split("||");
    return { accountNumber: number || null, accountName: rest.join("||") };
  }

  function openManual() {
    setManualDate(new Date().toISOString().slice(0, 10));
    setManualMemo("");
    setManualLines([blankManualLine(), blankManualLine()]);
    setShowManual(true);
  }

  const manualModal =
    showManual && canEdit && mounted
      ? createPortal(
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/50 p-4">
            <Card className="relative z-[201] max-h-[92vh] w-full max-w-4xl overflow-y-auto p-6 shadow-2xl">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
                  Create General Entry
                </h2>
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowManual(false)}>
                  Close
                </Button>
              </div>

              <form
                action={(fd) => {
                  const lines = manualLines
                    .map((line) => {
                      const a = parseAccount(line.accountValue);
                      return {
                        accountNumber: a.accountNumber,
                        accountName: a.accountName || a.accountNumber || "Account",
                        memo: line.memo || undefined,
                        debit: Number(line.debit || 0),
                        credit: Number(line.credit || 0),
                      };
                    })
                    .filter(
                      (l) =>
                        l.accountName ||
                        l.accountNumber ||
                        l.memo ||
                        l.debit ||
                        l.credit,
                    );

                  if (lines.length < 2) {
                    toast.error("A general entry needs at least two lines.");
                    return;
                  }
                  if (Math.abs(manualTotals.diff) >= 0.01) {
                    toast.error("General entry must balance before it can be saved.");
                    return;
                  }
                  if (manualTotals.debit <= 0 && manualTotals.credit <= 0) {
                    toast.error("Enter debit and credit amounts before saving.");
                    return;
                  }

                  fd.set("date", manualDate);
                  fd.set("memo", manualMemo);
                  fd.set("lines", JSON.stringify(lines));
                  return manualAction(fd);
                }}
                className="space-y-4"
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label>Entry Date</Label>
                    <Input
                      type="date"
                      value={manualDate}
                      onChange={(e) => setManualDate(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label>Memo / Description</Label>
                    <Input
                      value={manualMemo}
                      onChange={(e) => setManualMemo(e.target.value)}
                      placeholder="Journal entry description"
                    />
                  </div>
                </div>

                <div className="overflow-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Account</th>
                        <th className="px-3 py-2">Line Memo</th>
                        <th className="px-3 py-2 w-32">Debit</th>
                        <th className="px-3 py-2 w-32">Credit</th>
                        <th className="px-3 py-2 w-20" />
                      </tr>
                    </thead>
                    <tbody>
                      {manualLines.map((line, index) => (
                        <tr key={line.key} className="border-t border-slate-100">
                          <td className="px-3 py-2">
                            <Select
                              value={line.accountValue}
                              onChange={(e) => {
                                const next = [...manualLines];
                                next[index] = { ...line, accountValue: e.target.value };
                                setManualLines(next);
                              }}
                            >
                              <option value="">— Select account —</option>
                              {accounts.map((a) => (
                                <option key={a.number} value={`${a.number}||${a.name}`}>
                                  {a.number ? `${a.number} — ` : ""}
                                  {a.name}
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={line.memo}
                              onChange={(e) => {
                                const next = [...manualLines];
                                next[index] = { ...line, memo: e.target.value };
                                setManualLines(next);
                              }}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              step="0.01"
                              value={line.debit}
                              onChange={(e) => {
                                const next = [...manualLines];
                                next[index] = { ...line, debit: e.target.value };
                                setManualLines(next);
                              }}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              step="0.01"
                              value={line.credit}
                              onChange={(e) => {
                                const next = [...manualLines];
                                next[index] = { ...line, credit: e.target.value };
                                setManualLines(next);
                              }}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="danger"
                              onClick={() => {
                                setManualLines((prev) => {
                                  const next = prev.filter((_, i) => i !== index);
                                  return next.length ? next : [blankManualLine()];
                                });
                              }}
                            >
                              Delete
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setManualLines((prev) => [...prev, blankManualLine()])}
                  >
                    + Add Line
                  </Button>
                  <div className="text-sm text-slate-600">
                    <strong>Debits:</strong> {money(manualTotals.debit)}{" "}
                    <strong className="ml-2">Credits:</strong> {money(manualTotals.credit)}{" "}
                    <strong className="ml-2">Difference:</strong>{" "}
                    <span
                      className={
                        Math.abs(manualTotals.diff) < 0.01
                          ? "font-semibold text-teal-700"
                          : "font-semibold text-rose-700"
                      }
                    >
                      {money(manualTotals.diff)}
                    </span>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="secondary" onClick={() => setShowManual(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={manualPending}>
                    {manualPending ? "Saving…" : "Save General Entry"}
                  </Button>
                </div>
              </form>
            </Card>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            General Entries
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Generate balanced journals from categorized transactions, or create manual entries.
          </p>
        </div>
        <div className="toolbar-left flex flex-wrap gap-2">
          {canEdit ? (
            <form action={genAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="periodType" value="CUSTOM" />
              <input type="hidden" name="customStartDate" value={customStartDate} />
              <input type="hidden" name="customEndDate" value={customEndDate} />
              <input type="hidden" name="fiscalStartMonth" value={fiscalMonth} />
              <input type="hidden" name="fiscalStartDay" value="1" />
              <input type="hidden" name="inputTaxAccount" value={inputTaxAccount} />
              <input type="hidden" name="outputTaxAccount" value={outputTaxAccount} />
              <button type="submit" className="btn-converter btn-green" disabled={genPending}>
                {genPending ? "Generating…" : "Generate Automatic Entries"}
              </button>
              <button type="button" className="btn-converter btn-light" onClick={openManual}>
                + Create General Entry
              </button>
            </form>
          ) : null}
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
      </div>

      <div className="ge-toolbar flex flex-wrap items-end gap-2">
        <div>
          <Label className="text-[11px]">Start date</Label>
          <Input
            type="date"
            className="h-9"
            value={customStartDate}
            onChange={(e) => setCustomStartDate(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-[11px]">End date</Label>
          <Input
            type="date"
            className="h-9"
            value={customEndDate}
            onChange={(e) => setCustomEndDate(e.target.value)}
          />
        </div>
        <div className="min-w-[200px] flex-1">
          <Label className="text-[11px]">GST Paid / ITC Account</Label>
          <Select
            value={inputTaxAccount}
            onChange={(e) => setInputTaxAccount(e.target.value)}
            className="h-9"
          >
            <option value="">— Select account —</option>
            {accounts.map((a) => (
              <option key={`in-${a.number}`} value={`${a.number}||${a.name}`}>
                {a.number ? `${a.number} — ` : ""}
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[200px] flex-1">
          <Label className="text-[11px]">GST Collected / Payable Account</Label>
          <Select
            value={outputTaxAccount}
            onChange={(e) => setOutputTaxAccount(e.target.value)}
            className="h-9"
          >
            <option value="">— Select account —</option>
            {accounts.map((a) => (
              <option key={`out-${a.number}`} value={`${a.number}||${a.name}`}>
                {a.number ? `${a.number} — ` : ""}
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[140px]">
          <Label className="text-[11px]">Sort By</Label>
          <Select
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as "date" | "period" | "source" | "debit" | "credit")
            }
            className="h-9"
          >
            <option value="date">Date</option>
            <option value="period">Period</option>
            <option value="source">Source</option>
            <option value="debit">Total Debit</option>
            <option value="credit">Total Credit</option>
          </Select>
        </div>
        <div className="min-w-[130px]">
          <Label className="text-[11px]">Sort Direction</Label>
          <Select
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
            className="h-9"
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </Select>
        </div>
      </div>

      <p className="rounded-lg border border-[#d6e1e9] bg-[#f6f9fb] px-3 py-2 text-[12px] leading-snug text-[#52697a]">
        {fiscalExplanation}
      </p>

      <div className="ge-summary">
        <div className="card">
          <div className="k">Automatic Entries</div>
          <div className="v">{autoCount}</div>
        </div>
        <div className="card">
          <div className="k">Manual Entries</div>
          <div className="v">{manualCount}</div>
        </div>
        <div className="card">
          <div className="k">Total Debits</div>
          <div className="v">{money(totalDebit)}</div>
        </div>
        <div className="card">
          <div className="k">Total Credits</div>
          <div className="v">{money(totalCredit)}</div>
        </div>
        <div className="card">
          <div className="k">Difference</div>
          <div className={`v ${balanced ? "ge-balanced" : "ge-unbalanced"}`}>
            {money(difference)}
          </div>
        </div>
      </div>

      {canEdit && selected.size > 0 ? (
        <div className="toolbar toolbar-secondary">
          <div className="toolbar-secondary-row">
            <button
              type="button"
              className="btn-converter btn-danger"
              disabled={pendingBulk}
              onClick={deleteSelected}
            >
              {pendingBulk ? "Deleting…" : "Delete Selected"}
            </button>
            <button
              type="button"
              className="btn-converter btn-light"
              onClick={() => setSelected(new Set())}
            >
              Clear All
            </button>
            <span className="selected-count-pill has-selection toolbar-selected-count">
              {selected.size} selected
            </span>
          </div>
        </div>
      ) : null}

      <DualScrollArea className="card-table">
        <table className="ge-table">
          <thead>
            <tr>
              {canEdit ? (
                <th className="col-check">
                  <input
                    type="checkbox"
                    id="selectAllGeneralEntries"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all entries"
                    title="Select all"
                  />
                </th>
              ) : null}
              <th>Entry</th>
              <th>Period</th>
              <th>Date</th>
              <th>Source</th>
              <th>Account Number</th>
              <th>Account / Category</th>
              <th>Memo</th>
              <th className="text-right">Debit</th>
              <th className="text-right">Credit</th>
              {canEdit ? <th>Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {sortedEntries.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 11 : 9}>
                  <div className="ge-empty">
                    <h3 className="mb-2 text-base font-semibold text-[#354657]">
                      No general entries yet
                    </h3>
                    <div>
                      Generate automatic entries from converted transactions or create a manual
                      general entry.
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              sortedEntries.flatMap((entry, entryIndex) => {
                const jeLabel = `JE ${String(entryIndex + 1).padStart(3, "0")}`;
                const lines = entry.lines.length
                  ? entry.lines
                  : [
                      {
                        id: `${entry.id}-empty`,
                        accountNumber: null,
                        accountName: "—",
                        memo: entry.memo,
                        debit: 0,
                        credit: 0,
                      },
                    ];

                return lines.map((line, lineIndex) => {
                  const isFirst = lineIndex === 0;
                  return (
                    <tr
                      key={line.id}
                      className={`${isFirst ? "ge-entry-start" : ""} ${
                        selected.has(entry.id) ? "bg-rose-50/40" : ""
                      }`}
                    >
                      {canEdit ? (
                        <td className="col-check">
                          {isFirst ? (
                            <input
                              type="checkbox"
                              checked={selected.has(entry.id)}
                              onChange={() => toggleOne(entry.id)}
                              aria-label={`Select ${jeLabel}`}
                            />
                          ) : null}
                        </td>
                      ) : null}
                      <td>{isFirst ? <strong>{jeLabel}</strong> : null}</td>
                      <td className="ge-period">
                        {isFirst
                          ? entry.periodLabel || (entry.source === "MANUAL" ? "Manual" : "—")
                          : null}
                      </td>
                      <td>{isFirst ? entry.date : null}</td>
                      <td>
                        {isFirst ? (
                          <span
                            className={`ge-source ${
                              entry.source === "AUTOMATIC" ? "auto" : "manual"
                            }`}
                          >
                            {entry.source === "AUTOMATIC" ? "Automatic" : "Manual"}
                          </span>
                        ) : null}
                      </td>
                      <td>{line.accountNumber || ""}</td>
                      <td>{line.accountName || ""}</td>
                      <td>{line.memo || (isFirst ? entry.memo : "") || ""}</td>
                      <td className="ge-debit">{line.debit ? money(line.debit) : ""}</td>
                      <td className="ge-credit">{line.credit ? money(line.credit) : ""}</td>
                      {canEdit ? (
                        <td>
                          {isFirst ? (
                            <form
                              action={deleteGeneralEntryAction}
                              onSubmit={(e) => {
                                if (!confirm("Delete this general entry?")) e.preventDefault();
                              }}
                            >
                              <input type="hidden" name="id" value={entry.id} />
                              <Button
                                type="submit"
                                size="sm"
                                variant={entry.source === "MANUAL" ? "danger" : "secondary"}
                              >
                                Delete
                              </Button>
                            </form>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                });
              })
            )}
          </tbody>
        </table>
      </DualScrollArea>

      {manualModal}
    </div>
  );
}
