"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { updateTransactionCategoryAction, type ActionResult } from "@/app/actions/saves";
import { calculateTransactionAmounts } from "@/lib/transaction-math";
import type { TaxCodeInfo } from "@/lib/tax-reports";
import { Button, Card, Input, Label, Select } from "@/components/ui";

type Tx = {
  id: string;
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
};

export function EditTransactionDialog({
  tx,
  accounts,
  taxCatalog,
  onClose,
}: {
  tx: Tx;
  accounts: Array<{ number: string; name: string }>;
  taxCatalog: TaxCodeInfo[];
  onClose: () => void;
}) {
  const [account, setAccount] = useState(
    tx.accountNumber || tx.accountName
      ? `${tx.accountNumber ?? ""}||${tx.accountName ?? ""}`
      : "",
  );
  const [taxCodes, setTaxCodes] = useState(tx.taxCodes[0] ?? "");
  const [provinceTaxCodes, setProvinceTaxCodes] = useState(tx.provinceTaxCodes[0] ?? "");
  const [taxMode, setTaxMode] = useState(tx.taxMode === "EXCLUSIVE" ? "EXCLUSIVE" : "INCLUSIVE");
  const [province, setProvince] = useState(tx.province ?? "");
  const [notes, setNotes] = useState(tx.notes ?? "");
  const [description, setDescription] = useState(tx.description);

  const salesOptions = useMemo(
    () => taxCatalog.filter((t) => t.kind === "GST_HST" || t.kind === "NONE"),
    [taxCatalog],
  );
  const provinceOptions = useMemo(
    () => taxCatalog.filter((t) => t.kind === "PST"),
    [taxCatalog],
  );

  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(
    updateTransactionCategoryAction,
    undefined,
  );

  const preview = calculateTransactionAmounts(
    {
      moneyIn: tx.moneyIn,
      moneyOut: tx.moneyOut,
      taxCodes: taxCodes ? [taxCodes] : [],
      provinceTaxCodes: provinceTaxCodes ? [provinceTaxCodes] : [],
      taxMode: taxMode as "INCLUSIVE" | "EXCLUSIVE",
    },
    taxCatalog,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? "Saved");
      onClose();
    } else if (state?.error) toast.error(state.error);
  }, [state, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <Card className="w-full max-w-xl p-6">
        <h2 className="text-xl font-semibold">Edit & save category</h2>
        <p className="mt-1 text-sm text-slate-500">
          Sales tax (GST/HST) and province tax (PST/QST/RST) calculate separately.
        </p>

        <form action={action} className="mt-4 space-y-3">
          <input type="hidden" name="id" value={tx.id} />
          <div>
            <Label>Description</Label>
            <Input
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <Label>Category / Account</Label>
            <Select
              name="account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">— Uncategorized —</option>
              {accounts.map((a) => (
                <option key={a.number} value={`${a.number}||${a.name}`}>
                  {a.number} · {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Sales tax (GST / HST)</Label>
              <Select
                name="taxCodes"
                value={taxCodes}
                onChange={(e) => setTaxCodes(e.target.value)}
              >
                <option value="">— None —</option>
                {salesOptions.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.code} ({t.rate}%)
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Province tax (PST / QST / RST)</Label>
              <Select
                name="provinceTaxCodes"
                value={provinceTaxCodes}
                onChange={(e) => setProvinceTaxCodes(e.target.value)}
              >
                <option value="">— None —</option>
                {provinceOptions.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.code} ({t.rate}%)
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Tax treatment</Label>
              <Select
                name="taxMode"
                value={taxMode}
                onChange={(e) => setTaxMode(e.target.value)}
              >
                <option value="INCLUSIVE">Inclusive</option>
                <option value="EXCLUSIVE">Exclusive</option>
              </Select>
            </div>
            <div>
              <Label>Province</Label>
              <Input
                name="province"
                value={province}
                onChange={(e) => setProvince(e.target.value.toUpperCase())}
                maxLength={2}
              />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Input name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">Gross</p>
              <p className="font-semibold">${preview.gross.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Sales Tax</p>
              <p className="font-semibold">${preview.salesTaxAmount.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Province Tax</p>
              <p className="font-semibold">${preview.provinceTaxAmount.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Net</p>
              <p className="font-semibold">${preview.netAmount.toFixed(2)}</p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save category"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
