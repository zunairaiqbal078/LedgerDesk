"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  bulkDeleteReconciliationsAction,
  deleteReconciliationAction,
  saveReconciliationAction,
  undoReconciliationAction,
} from "@/app/actions/accounting";
import { DualScrollArea } from "@/components/dual-scroll-area";
import { Badge, Button, Card, Input, Label } from "@/components/ui";

type Tx = {
  id: string;
  date: string;
  description: string;
  moneyIn: number;
  moneyOut: number;
  accountName: string | null;
  reconciledIn: boolean;
  reconciledOut: boolean;
};

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

export function ReconciliationWorkspace({
  bankName,
  bankType,
  transactions,
  history,
  suggestedOpening,
  canEdit,
}: {
  bankName: string | null;
  bankType: "BANK" | "CREDIT_CARD" | null;
  transactions: Tx[];
  history: HistoryItem[];
  suggestedOpening: number;
  canEdit: boolean;
}) {
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [opening, setOpening] = useState(String(suggestedOpening));
  const [ending, setEnding] = useState("0");
  const [showReconciled, setShowReconciled] = useState(false);
  const [clearedIn, setClearedIn] = useState<Set<string>>(new Set());
  const [clearedOut, setClearedOut] = useState<Set<string>>(new Set());
  const [historySelected, setHistorySelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const terms = query
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    return transactions.filter((tx) => {
      if (tx.date > endDate) return false;
      if (!showReconciled && (tx.reconciledIn || tx.reconciledOut)) {
        if (tx.moneyIn > 0 && tx.reconciledIn && tx.moneyOut === 0) return false;
        if (tx.moneyOut > 0 && tx.reconciledOut && tx.moneyIn === 0) return false;
      }
      if (!terms.length) return true;
      const hay = `${tx.description} ${tx.accountName ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [transactions, endDate, showReconciled, query]);

  const clearableInIds = useMemo(
    () => visible.filter((tx) => tx.moneyIn > 0 && !tx.reconciledIn).map((tx) => tx.id),
    [visible],
  );
  const clearableOutIds = useMemo(
    () => visible.filter((tx) => tx.moneyOut > 0 && !tx.reconciledOut).map((tx) => tx.id),
    [visible],
  );

  const allInSelected =
    clearableInIds.length > 0 && clearableInIds.every((id) => clearedIn.has(id));
  const allOutSelected =
    clearableOutIds.length > 0 && clearableOutIds.every((id) => clearedOut.has(id));
  const allRowsSelected =
    (clearableInIds.length > 0 || clearableOutIds.length > 0) &&
    clearableInIds.every((id) => clearedIn.has(id)) &&
    clearableOutIds.every((id) => clearedOut.has(id));

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
    const shouldClear =
      (tx.moneyIn > 0 && !tx.reconciledIn && !clearedIn.has(tx.id)) ||
      (tx.moneyOut > 0 && !tx.reconciledOut && !clearedOut.has(tx.id));
    if (tx.moneyIn > 0 && !tx.reconciledIn) {
      setClearedIn((prev) => {
        const next = new Set(prev);
        if (shouldClear) next.add(tx.id);
        else next.delete(tx.id);
        return next;
      });
    }
    if (tx.moneyOut > 0 && !tx.reconciledOut) {
      setClearedOut((prev) => {
        const next = new Set(prev);
        if (shouldClear) next.add(tx.id);
        else next.delete(tx.id);
        return next;
      });
    }
  }

  function rowFullyCleared(tx: Tx) {
    const inOk = tx.moneyIn <= 0 || tx.reconciledIn || clearedIn.has(tx.id);
    const outOk = tx.moneyOut <= 0 || tx.reconciledOut || clearedOut.has(tx.id);
    return inOk && outOk && (tx.moneyIn > 0 || tx.moneyOut > 0);
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

      {canEdit ? (
        <div className="toolbar-left flex flex-wrap gap-2">
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
          {(clearedIn.size > 0 || clearedOut.size > 0) ? (
            <span className="selected-count-pill has-selection">
              {new Set([...clearedIn, ...clearedOut]).size} cleared
            </span>
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
                    title="Select all visible"
                  />
                </th>
              ) : null}
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th className="text-right">
                {canEdit ? (
                  <label className="inline-flex items-center justify-end gap-2">
                    <input
                      type="checkbox"
                      checked={allInSelected}
                      disabled={!clearableInIds.length}
                      onChange={toggleAllIn}
                      aria-label="Select all Money In"
                      title="Select all Money In"
                    />
                    Money In
                  </label>
                ) : (
                  "Money In"
                )}
              </th>
              <th className="text-right">
                {canEdit ? (
                  <label className="inline-flex items-center justify-end gap-2">
                    <input
                      type="checkbox"
                      checked={allOutSelected}
                      disabled={!clearableOutIds.length}
                      onChange={toggleAllOut}
                      aria-label="Select all Money Out"
                      title="Select all Money Out"
                    />
                    Money Out
                  </label>
                ) : (
                  "Money Out"
                )}
              </th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((tx) => {
              const rowChecked = rowFullyCleared(tx);
              const rowDisabled =
                (tx.moneyIn <= 0 || tx.reconciledIn) && (tx.moneyOut <= 0 || tx.reconciledOut);
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
                  <td className="whitespace-nowrap">{tx.date}</td>
                  <td>{tx.description}</td>
                  <td>{tx.accountName || "—"}</td>
                  <td className="text-right">
                    {tx.moneyIn > 0 ? (
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          disabled={!canEdit || tx.reconciledIn}
                          checked={clearedIn.has(tx.id) || tx.reconciledIn}
                          onChange={() => toggleIn(tx.id)}
                        />
                        ${tx.moneyIn.toFixed(2)}
                      </label>
                    ) : null}
                  </td>
                  <td className="text-right">
                    {tx.moneyOut > 0 ? (
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          disabled={!canEdit || tx.reconciledOut}
                          checked={clearedOut.has(tx.id) || tx.reconciledOut}
                          onChange={() => toggleOut(tx.id)}
                        />
                        ${tx.moneyOut.toFixed(2)}
                      </label>
                    ) : null}
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
                </tr>
              );
            })}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 7 : 6} className="px-4 py-8 text-center text-slate-500">
                  No transactions in this statement period.
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
