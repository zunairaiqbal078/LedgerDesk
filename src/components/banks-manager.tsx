"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { bulkDeleteBanksAction, deleteBankAction } from "@/app/actions/org";
import { CreateBankForm } from "@/components/bank-form";
import { DualScrollArea } from "@/components/dual-scroll-area";
import { Badge, Button, Card } from "@/components/ui";

type Bank = {
  id: string;
  name: string;
  type: "BANK" | "CREDIT_CARD";
  mask: string | null;
  currency: string;
};

export function BanksManager({
  banks,
  activeBankId,
  canManage,
}: {
  banks: Bank[];
  activeBankId: string | null;
  canManage: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const allSelected = banks.length > 0 && banks.every((b) => selected.has(b.id));

  function toggleAll() {
    setSelected((prev) => {
      if (allSelected) return new Set();
      return new Set(banks.map((b) => b.id));
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

  function deleteOne(bank: Bank) {
    if (
      !confirm(
        `Delete bank “${bank.name}”? All of its transactions will also be permanently deleted.`,
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.set("id", bank.id);
    startTransition(async () => {
      const result = await deleteBankAction(fd);
      if (result.ok) {
        toast.success(result.message ?? "Deleted");
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(bank.id);
          return next;
        });
      } else toast.error(result.error ?? "Delete failed");
    });
  }

  function deleteSelected() {
    if (!selected.size) return;
    if (
      !confirm(
        `Delete ${selected.size} bank(s)? All transactions in those banks will also be deleted.`,
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.set("ids", [...selected].join(","));
    startTransition(async () => {
      const result = await bulkDeleteBanksAction(fd);
      if (result.ok) {
        toast.success(result.message ?? "Deleted");
        setSelected(new Set());
      } else toast.error(result.error ?? "Delete failed");
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">Banks</h1>
        <p className="mt-1 text-sm text-slate-500">
          One organization can manage multiple banks. Selecting a bank filters transactions across
          the workspace.
        </p>
      </div>

      {canManage ? (
        <Card className="p-6">
          <h2 className="mb-4 text-lg font-semibold">Add bank account</h2>
          <CreateBankForm />
        </Card>
      ) : null}

      {canManage && selected.size > 0 ? (
        <Card className="flex flex-wrap items-center gap-3 border-rose-200 bg-rose-50/50 p-4">
          <span className="text-sm font-semibold text-rose-900">{selected.size} selected</span>
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={deleteSelected}
          >
            {pending ? "Deleting…" : "Delete selected"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </Card>
      ) : null}

      <DualScrollArea className="card-table">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {canManage ? (
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all banks"
                  />
                </th>
              ) : null}
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Mask</th>
              <th className="px-4 py-3">Currency</th>
              <th className="px-4 py-3">Status</th>
              {canManage ? <th className="px-4 py-3">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {banks.map((bank) => (
              <tr
                key={bank.id}
                className={`border-t border-slate-100 ${selected.has(bank.id) ? "bg-rose-50/40" : ""}`}
              >
                {canManage ? (
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selected.has(bank.id)}
                      onChange={() => toggleOne(bank.id)}
                      aria-label={`Select ${bank.name}`}
                    />
                  </td>
                ) : null}
                <td className="px-4 py-3 font-medium">{bank.name}</td>
                <td className="px-4 py-3">{bank.type === "BANK" ? "Bank" : "Credit Card"}</td>
                <td className="px-4 py-3">{bank.mask ? `•••• ${bank.mask}` : "—"}</td>
                <td className="px-4 py-3">{bank.currency}</td>
                <td className="px-4 py-3">
                  {activeBankId === bank.id ? (
                    <Badge className="border-teal-200 bg-teal-50 text-teal-800">Selected</Badge>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                {canManage ? (
                  <td className="px-4 py-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={pending}
                      onClick={() => deleteOne(bank)}
                    >
                      Delete
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
            {banks.length === 0 ? (
              <tr>
                <td
                  colSpan={canManage ? 7 : 5}
                  className="px-4 py-10 text-center text-slate-500"
                >
                  No banks yet. Add one to unlock imports and reconciliations.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </DualScrollArea>
    </div>
  );
}
