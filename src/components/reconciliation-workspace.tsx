"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  deleteReconciliationAction,
  saveReconciliationAction,
  undoReconciliationAction,
} from "@/app/actions/accounting";
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
        // still show if not fully reconciled for the side that has amount
        if (tx.moneyIn > 0 && tx.reconciledIn && tx.moneyOut === 0) return false;
        if (tx.moneyOut > 0 && tx.reconciledOut && tx.moneyIn === 0) return false;
      }
      if (!terms.length) return true;
      const hay = `${tx.description} ${tx.accountName ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [transactions, endDate, showReconciled, query]);

  const clearedInTotal = visible
    .filter((tx) => clearedIn.has(tx.id))
    .reduce((s, tx) => s + tx.moneyIn, 0);
  const clearedOutTotal = visible
    .filter((tx) => clearedOut.has(tx.id))
    .reduce((s, tx) => s + tx.moneyOut, 0);
  const openingNum = Number(opening) || 0;
  const endingNum = Number(ending) || 0;
  // Bank: opening + in − out. Credit card (HTML converter): opening + out − in.
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
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={pending} onClick={() => save("DRAFT")}>
            Save draft
          </Button>
          <Button
            type="button"
            disabled={pending || Math.abs(difference) >= 0.01}
            onClick={() => save("FINISHED")}
          >
            Finish reconciliation
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setClearedIn(new Set());
              setClearedOut(new Set());
            }}
          >
            Clear checks
          </Button>
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3 text-right">Money In</th>
              <th className="px-4 py-3 text-right">Money Out</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((tx) => (
              <tr
                key={tx.id}
                className={`border-t border-slate-100 ${
                  clearedIn.has(tx.id) || clearedOut.has(tx.id) ? "bg-sky-50/50" : ""
                }`}
              >
                <td className="px-4 py-3 whitespace-nowrap">{tx.date}</td>
                <td className="px-4 py-3">{tx.description}</td>
                <td className="px-4 py-3">{tx.accountName || "—"}</td>
                <td className="px-4 py-3 text-right">
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
                <td className="px-4 py-3 text-right">
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
                <td className="px-4 py-3">
                  {tx.reconciledIn || tx.reconciledOut ? (
                    <Badge className="border-teal-200 bg-teal-50 text-teal-800">Reconciled</Badge>
                  ) : clearedIn.has(tx.id) || clearedOut.has(tx.id) ? (
                    <Badge className="border-sky-200 bg-sky-50 text-sky-800">Cleared</Badge>
                  ) : (
                    <span className="text-slate-400">Open</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 font-semibold">History</div>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">End date</th>
              <th className="px-4 py-3 text-right">Statement</th>
              <th className="px-4 py-3 text-right">Difference</th>
              <th className="px-4 py-3">Selections</th>
              <th className="px-4 py-3">Saved</th>
              {canEdit ? <th className="px-4 py-3">Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {history.map((item) => (
              <tr key={item.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <Badge>{item.status}</Badge>
                </td>
                <td className="px-4 py-3">{item.endDate}</td>
                <td className="px-4 py-3 text-right">
                  ${item.statementEndingBalance.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right">${item.difference.toFixed(2)}</td>
                <td className="px-4 py-3">{item.clearedCount}</td>
                <td className="px-4 py-3">{item.savedAt}</td>
                {canEdit ? (
                  <td className="px-4 py-3">
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
                      {item.status !== "FINISHED" ? (
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
            ))}
            {history.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  No reconciliation history yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
