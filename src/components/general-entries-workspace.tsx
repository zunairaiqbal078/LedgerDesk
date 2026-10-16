"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  bulkDeleteGeneralEntriesAction,
  createManualGeneralEntryAction,
  deleteGeneralEntryAction,
  generateGeneralEntriesAction,
  type ActionResult,
} from "@/app/actions/accounting";
import { Badge, Button, Card, Input, Label, Select } from "@/components/ui";

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

export function GeneralEntriesWorkspace({
  entries,
  accounts,
  canEdit,
}: {
  entries: Entry[];
  accounts: AccountOption[];
  canEdit: boolean;
}) {
  const [periodType, setPeriodType] = useState("MONTHLY");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingBulk, startBulk] = useTransition();
  const [showManual, setShowManual] = useState(false);
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualMemo, setManualMemo] = useState("");
  const [line1Account, setLine1Account] = useState("");
  const [line1Debit, setLine1Debit] = useState("");
  const [line1Credit, setLine1Credit] = useState("");
  const [line2Account, setLine2Account] = useState("");
  const [line2Debit, setLine2Debit] = useState("");
  const [line2Credit, setLine2Credit] = useState("");

  const [genState, genAction, genPending] = useActionState<
    ActionResult | undefined,
    FormData
  >(generateGeneralEntriesAction, undefined);
  const [manualState, manualAction, manualPending] = useActionState<
    ActionResult | undefined,
    FormData
  >(createManualGeneralEntryAction, undefined);

  useEffect(() => {
    if (genState?.ok) toast.success(genState.message);
    else if (genState?.error) toast.error(genState.error);
  }, [genState]);

  useEffect(() => {
    if (manualState?.ok) {
      toast.success(manualState.message);
      setShowManual(false);
    } else if (manualState?.error) toast.error(manualState.error);
  }, [manualState]);

  const autoCount = entries.filter((e) => e.source === "AUTOMATIC").length;
  const manualCount = entries.filter((e) => e.source === "MANUAL").length;
  const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0);
  const allSelected = entries.length > 0 && entries.every((e) => selected.has(e.id));

  function toggleAll() {
    setSelected((prev) => {
      if (allSelected) return new Set();
      return new Set(entries.map((e) => e.id));
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

  function parseAccount(value: string) {
    const [number, ...rest] = value.split("||");
    return { accountNumber: number || null, accountName: rest.join("||") };
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            General Entries
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Generate balanced journals from categorized transactions, or create manual entries.
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <form action={genAction} className="flex gap-2">
              <Select
                name="periodType"
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value)}
                className="w-40"
              >
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="YEARLY">Yearly</option>
              </Select>
              <Button type="submit" disabled={genPending}>
                {genPending ? "Generating…" : "Generate automatic"}
              </Button>
            </form>
            <Button type="button" variant="secondary" onClick={() => setShowManual(true)}>
              + Manual entry
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {[
          ["Automatic", autoCount],
          ["Manual", manualCount],
          ["Total debits", `$${totalDebit.toFixed(2)}`],
          ["Total credits", `$${totalCredit.toFixed(2)}`],
          ["Difference", `$${(totalDebit - totalCredit).toFixed(2)}`],
        ].map(([label, value]) => (
          <Card key={String(label)} className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-semibold">{value}</p>
          </Card>
        ))}
      </div>

      {showManual && canEdit ? (
        <Card className="p-6">
          <h2 className="mb-4 text-lg font-semibold">Create manual entry</h2>
          <form
            action={(fd) => {
              const a1 = parseAccount(line1Account);
              const a2 = parseAccount(line2Account);
              fd.set("date", manualDate);
              fd.set("memo", manualMemo);
              fd.set(
                "lines",
                JSON.stringify([
                  {
                    accountNumber: a1.accountNumber,
                    accountName: a1.accountName || "Account 1",
                    debit: Number(line1Debit || 0),
                    credit: Number(line1Credit || 0),
                  },
                  {
                    accountNumber: a2.accountNumber,
                    accountName: a2.accountName || "Account 2",
                    debit: Number(line2Debit || 0),
                    credit: Number(line2Credit || 0),
                  },
                ]),
              );
              return manualAction(fd);
            }}
            className="space-y-3"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Date</Label>
                <Input
                  type="date"
                  value={manualDate}
                  onChange={(e) => setManualDate(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>Memo</Label>
                <Input value={manualMemo} onChange={(e) => setManualMemo(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="md:col-span-2">
                <Label>Line 1 account</Label>
                <Select value={line1Account} onChange={(e) => setLine1Account(e.target.value)}>
                  <option value="">— Select —</option>
                  {accounts.map((a) => (
                    <option key={a.number} value={`${a.number}||${a.name}`}>
                      {a.number} · {a.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Debit</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={line1Debit}
                  onChange={(e) => setLine1Debit(e.target.value)}
                />
              </div>
              <div>
                <Label>Credit</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={line1Credit}
                  onChange={(e) => setLine1Credit(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="md:col-span-2">
                <Label>Line 2 account</Label>
                <Select value={line2Account} onChange={(e) => setLine2Account(e.target.value)}>
                  <option value="">— Select —</option>
                  {accounts.map((a) => (
                    <option key={a.number} value={`${a.number}||${a.name}`}>
                      {a.number} · {a.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Debit</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={line2Debit}
                  onChange={(e) => setLine2Debit(e.target.value)}
                />
              </div>
              <div>
                <Label>Credit</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={line2Credit}
                  onChange={(e) => setLine2Credit(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={manualPending}>
                Save entry
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowManual(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

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

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {canEdit ? (
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all entries"
                  />
                </th>
              ) : null}
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Period</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Memo / Lines</th>
              <th className="px-4 py-3 text-right">Debit</th>
              <th className="px-4 py-3 text-right">Credit</th>
              {canEdit ? <th className="px-4 py-3">Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.id}
                className={`border-t border-slate-100 align-top ${selected.has(entry.id) ? "bg-rose-50/40" : ""}`}
              >
                {canEdit ? (
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selected.has(entry.id)}
                      onChange={() => toggleOne(entry.id)}
                      aria-label={`Select entry ${entry.memo || entry.date}`}
                    />
                  </td>
                ) : null}
                <td className="px-4 py-3 whitespace-nowrap">{entry.date}</td>
                <td className="px-4 py-3">{entry.periodLabel || "—"}</td>
                <td className="px-4 py-3">
                  <Badge
                    className={
                      entry.source === "AUTOMATIC"
                        ? "border-sky-200 bg-sky-50 text-sky-800"
                        : "border-teal-200 bg-teal-50 text-teal-800"
                    }
                  >
                    {entry.source}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{entry.memo || "Entry"}</div>
                  <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                    {entry.lines.map((line) => (
                      <li key={line.id}>
                        {line.accountNumber ? `${line.accountNumber} · ` : ""}
                        {line.accountName} — Dr {line.debit.toFixed(2)} / Cr{" "}
                        {line.credit.toFixed(2)}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-4 py-3 text-right">${entry.debit.toFixed(2)}</td>
                <td className="px-4 py-3 text-right">${entry.credit.toFixed(2)}</td>
                {canEdit ? (
                  <td className="px-4 py-3">
                    <form
                      action={deleteGeneralEntryAction}
                      onSubmit={(e) => {
                        if (!confirm("Delete this general entry?")) e.preventDefault();
                      }}
                    >
                      <input type="hidden" name="id" value={entry.id} />
                      <Button type="submit" size="sm" variant="danger">
                        Delete
                      </Button>
                    </form>
                  </td>
                ) : null}
              </tr>
            ))}
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={canEdit ? 8 : 6}
                  className="px-4 py-10 text-center text-slate-500"
                >
                  No general entries yet. Categorize transactions, then generate.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
