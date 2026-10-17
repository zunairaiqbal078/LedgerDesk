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

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

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
  fiscalYearStartDay = 1,
  defaultInputTaxAccount = "",
  defaultOutputTaxAccount = "",
}: {
  entries: Entry[];
  accounts: AccountOption[];
  canEdit: boolean;
  fiscalYearStartMonth?: number;
  fiscalYearStartDay?: number;
  defaultInputTaxAccount?: string;
  defaultOutputTaxAccount?: string;
}) {
  const [periodType, setPeriodType] = useState("MONTHLY");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [fiscalMonth, setFiscalMonth] = useState(String(fiscalYearStartMonth || 1));
  const [fiscalDay, setFiscalDay] = useState(String(fiscalYearStartDay || 1));
  const [inputTaxAccount, setInputTaxAccount] = useState(defaultInputTaxAccount);
  const [outputTaxAccount, setOutputTaxAccount] = useState(defaultOutputTaxAccount);
  const [sortBy, setSortBy] = useState<"date" | "period" | "source" | "debit" | "credit">(
    "date",
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
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
    const month = MONTHS[Math.min(11, Math.max(0, Number(fiscalMonth) - 1))] ?? "January";
    const day = Math.min(28, Math.max(1, Number(fiscalDay) || 1));
    let txt = `Fiscal year starts ${month} ${day}. `;
    if (periodType === "CUSTOM") {
      txt +=
        customStartDate && customEndDate
          ? `Automatic entries will include only transactions from ${customStartDate} through ${customEndDate} and create summarized journal entries for that range.`
          : "Choose a custom start date and end date to generate summarized journal entries for that range.";
    } else if (periodType === "QUARTERLY") {
      txt +=
        "Quarter 1 begins on the fiscal-year start date and each quarter covers three fiscal months.";
    } else if (periodType === "YEARLY") {
      txt += "Yearly entries cover the full fiscal year, not January–December.";
    } else {
      txt +=
        "Monthly entries are grouped by month and labeled within the applicable fiscal year.";
    }
    return txt;
  }, [fiscalMonth, fiscalDay, periodType, customStartDate, customEndDate]);

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
    toast.success("CSV exported.");
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
    toast.success("Excel exported.");
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
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <form action={genAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="periodType" value={periodType} />
              <input type="hidden" name="customStartDate" value={customStartDate} />
              <input type="hidden" name="customEndDate" value={customEndDate} />
              <input type="hidden" name="fiscalStartMonth" value={fiscalMonth} />
              <input type="hidden" name="fiscalStartDay" value={fiscalDay} />
              <input type="hidden" name="inputTaxAccount" value={inputTaxAccount} />
              <input type="hidden" name="outputTaxAccount" value={outputTaxAccount} />
              <Button type="submit" disabled={genPending}>
                {genPending ? "Generating…" : "Generate Automatic Entries"}
              </Button>
              <Button type="button" variant="secondary" onClick={openManual}>
                + Create General Entry
              </Button>
              <Button type="button" variant="secondary" onClick={exportCsv}>
                Export CSV
              </Button>
              <Button type="button" variant="secondary" onClick={exportExcel}>
                Export Excel
              </Button>
            </form>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={exportCsv}>
                Export CSV
              </Button>
              <Button type="button" variant="secondary" onClick={exportExcel}>
                Export Excel
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="ge-toolbar flex flex-wrap items-end gap-2">
        <div className="min-w-[150px]">
          <Label className="text-[11px]">Generate by</Label>
          <Select
            value={periodType}
            onChange={(e) => setPeriodType(e.target.value)}
            className="h-9"
          >
            <option value="MONTHLY">Monthly</option>
            <option value="QUARTERLY">Quarterly</option>
            <option value="YEARLY">Yearly</option>
            <option value="CUSTOM">Custom Date Range</option>
          </Select>
        </div>
        {periodType === "CUSTOM" ? (
          <>
            <div>
              <Label className="text-[11px]">Custom start date</Label>
              <Input
                type="date"
                className="h-9"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-[11px]">Custom end date</Label>
              <Input
                type="date"
                className="h-9"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
              />
            </div>
          </>
        ) : null}
        <div className="min-w-[150px]">
          <Label className="text-[11px]">Fiscal year starts</Label>
          <Select
            value={fiscalMonth}
            onChange={(e) => setFiscalMonth(e.target.value)}
            className="h-9"
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={String(i + 1)}>
                {m}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-[110px]">
          <Label className="text-[11px]">Start day</Label>
          <Input
            type="number"
            min={1}
            max={28}
            className="h-9"
            value={fiscalDay}
            onChange={(e) => setFiscalDay(e.target.value)}
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
        <Card className="flex flex-wrap items-center gap-3 border-rose-200 bg-rose-50/50 p-4">
          <span className="text-sm font-semibold text-rose-900">{selected.size} selected</span>
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={pendingBulk}
            onClick={deleteSelected}
          >
            {pendingBulk ? "Deleting…" : "Delete selected"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </Card>
      ) : null}

      <DualScrollArea className="card-table">
        <table className="ge-table">
          <thead>
            <tr>
              {canEdit ? (
                <th>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all entries"
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
                        <td>
                          {isFirst ? (
                            <input
                              type="checkbox"
                              className="h-4 w-4"
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
