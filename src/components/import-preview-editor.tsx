"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui";

export type ImportPreviewRow = {
  id: string;
  excluded: boolean;
  date: string;
  description: string;
  moneyIn: string;
  moneyOut: string;
  notes?: string;
  externalTransactionId?: string;
  accountNumber?: string;
  accountName?: string;
  province?: string;
};

export function importPreviewFromPending(
  rows: Array<{
    date: string;
    description: string;
    moneyIn: number;
    moneyOut: number;
    notes?: string;
    externalTransactionId?: string;
    accountNumber?: string;
    accountName?: string;
    province?: string;
  }>,
): ImportPreviewRow[] {
  return rows.map((row, idx) => ({
    id: `import-${idx}-${row.date.slice(0, 10)}-${Math.random().toString(36).slice(2, 7)}`,
    excluded: false,
    date: row.date.slice(0, 10),
    description: row.description,
    moneyIn: row.moneyIn ? String(row.moneyIn) : "",
    moneyOut: row.moneyOut ? String(row.moneyOut) : "",
    notes: row.notes,
    externalTransactionId: row.externalTransactionId,
    accountNumber: row.accountNumber,
    accountName: row.accountName,
    province: row.province,
  }));
}

export function importPreviewToPending(rows: ImportPreviewRow[]) {
  return rows
    .filter((r) => !r.excluded)
    .map((row) => {
      const dateRaw = row.date.trim();
      const date =
        dateRaw.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)
          ? `${dateRaw}T12:00:00.000Z`
          : dateRaw;
      return {
        date,
        description: row.description.trim() || "—",
        moneyIn: Math.max(0, Number(row.moneyIn) || 0),
        moneyOut: Math.max(0, Number(row.moneyOut) || 0),
        notes: row.notes,
        externalTransactionId: row.externalTransactionId,
        accountNumber: row.accountNumber,
        accountName: row.accountName,
        province: row.province,
      };
    });
}

export function ImportPreviewEditor({
  rows,
  onChange,
  skippedCount = 0,
}: {
  rows: ImportPreviewRow[];
  onChange: (rows: ImportPreviewRow[]) => void;
  skippedCount?: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const activeRows = useMemo(() => rows.filter((r) => !r.excluded), [rows]);
  const totals = useMemo(() => {
    let moneyIn = 0;
    let moneyOut = 0;
    for (const row of activeRows) {
      moneyIn += Number(row.moneyIn) || 0;
      moneyOut += Number(row.moneyOut) || 0;
    }
    return { moneyIn, moneyOut, count: activeRows.length };
  }, [activeRows]);

  const allSelected =
    activeRows.length > 0 && activeRows.every((r) => selected.has(r.id));

  function patchRow(id: string, patch: Partial<ImportPreviewRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(activeRows.map((r) => r.id)));
  }

  function removeSelected() {
    if (!selected.size) return;
    const ids = selected;
    onChange(rows.filter((r) => !ids.has(r.id)));
    setSelected(new Set());
  }

  if (!rows.length) {
    return (
      <p className="mt-3 text-sm text-slate-500">
        No transactions to preview. Adjust column mapping or try another file.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          Preview: <strong>{totals.count}</strong> transaction
          {totals.count === 1 ? "" : "s"} will import
          {skippedCount > 0 ? (
            <span className="text-rose-700"> · {skippedCount} row(s) skipped by parser</span>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!selected.size}
            onClick={removeSelected}
          >
            Delete selected ({selected.size})
          </Button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Edit any field below or delete rows before importing. Money in $
        {totals.moneyIn.toFixed(2)} · money out ${totals.moneyOut.toFixed(2)}
      </p>
      <div className="max-h-[55vh] overflow-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="sticky top-0 z-[1] bg-slate-50 shadow-sm">
            <tr>
              <th className="px-2 py-2 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all preview rows"
                />
              </th>
              <th className="px-2 py-2 w-10">#</th>
              <th className="px-2 py-2 whitespace-nowrap">Date</th>
              <th className="px-2 py-2 min-w-[240px]">Description</th>
              <th className="px-2 py-2 whitespace-nowrap w-28">Money In</th>
              <th className="px-2 py-2 whitespace-nowrap w-28">Money Out</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => !r.excluded)
              .map((row, idx) => (
                <tr key={row.id} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleOne(row.id)}
                      aria-label={`Select row ${idx + 1}`}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-slate-400">{idx + 1}</td>
                  <td className="px-2 py-1.5">
                    <input
                      type="date"
                      className="h-8 w-full min-w-[8.5rem] rounded-md border border-slate-200 px-2 text-xs"
                      value={row.date.slice(0, 10)}
                      onChange={(e) => patchRow(row.id, { date: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs"
                      value={row.description}
                      onChange={(e) => patchRow(row.id, { description: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs text-right text-emerald-800"
                      value={row.moneyIn}
                      onChange={(e) => patchRow(row.id, { moneyIn: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs text-right text-rose-800"
                      value={row.moneyOut}
                      onChange={(e) => patchRow(row.id, { moneyOut: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
