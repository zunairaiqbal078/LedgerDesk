"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { bulkCategorizeAction } from "@/app/actions/books";
import { CANADIAN_PROVINCES } from "@/lib/canada-provinces";
import type { TaxCodeInfo } from "@/lib/tax-reports";

type Bank = { id: string; name: string; type: "BANK" | "CREDIT_CARD" };
type Account = { number: string; name: string };
type TaxOption = { code: string; kind?: string };

export function BulkEditTransactionsModal({
  open,
  onClose,
  selectedIds,
  totalCount,
  banks,
  accounts,
  taxCodes,
  taxCatalog,
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: string[];
  totalCount: number;
  banks: Bank[];
  accounts: Account[];
  taxCodes: TaxOption[];
  taxCatalog: TaxCodeInfo[];
}) {
  const [pending, startTransition] = useTransition();
  const [scope, setScope] = useState<"selected" | "all">(
    selectedIds.length ? "selected" : "all",
  );
  const [applyPosting, setApplyPosting] = useState(false);
  const [applyAccount, setApplyAccount] = useState(false);
  const [applyProvince, setApplyProvince] = useState(false);
  const [applyTax, setApplyTax] = useState(false);
  const [applyTaxMode, setApplyTaxMode] = useState(false);
  const [bankAccountId, setBankAccountId] = useState(banks[0]?.id ?? "");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [province, setProvince] = useState("");
  const [selectedTaxes, setSelectedTaxes] = useState<string[]>([]);
  const [taxMode, setTaxMode] = useState<"INCLUSIVE" | "EXCLUSIVE">("INCLUSIVE");

  const allTaxOptions = useMemo(
    () =>
      taxCodes.map((t) => ({
        code: t.code,
        label: t.code,
        kind: t.kind,
      })),
    [taxCodes],
  );

  if (!open) return null;

  function syncAccountFromNumber(num: string) {
    setAccountNumber(num);
    const ac = accounts.find((a) => a.number === num);
    if (ac) setAccountName(ac.name);
  }

  function syncAccountFromName(name: string) {
    setAccountName(name);
    const ac = accounts.find((a) => a.name === name);
    if (ac) setAccountNumber(ac.number);
  }

  function apply() {
    const flags = [applyPosting, applyAccount, applyProvince, applyTax, applyTaxMode];
    if (!flags.some(Boolean)) {
      toast.error("Choose at least one field to bulk edit.");
      return;
    }
    if (scope === "selected" && selectedIds.length === 0) {
      toast.error("No selected transactions to bulk edit.");
      return;
    }

    const salesSelected: string[] = [];
    const provinceSelected: string[] = [];
    for (const code of selectedTaxes) {
      const meta = taxCatalog.find((t) => t.code === code);
      if (meta?.kind === "PST") provinceSelected.push(code);
      else salesSelected.push(code);
    }

    const formData = new FormData();
    formData.set("scope", scope);
    if (scope === "selected") formData.set("ids", selectedIds.join(","));

    if (applyPosting) {
      formData.set("applyPostingAccount", "true");
      formData.set("bankAccountId", bankAccountId);
    }
    if (applyAccount) {
      formData.set("applyAccount", "true");
      formData.set("accountNumber", accountNumber);
      formData.set("accountName", accountName);
    }
    if (applyProvince) {
      formData.set("applyProvince", "true");
      formData.set("province", province);
    }
    if (applyTax) {
      if (selectedTaxes.length === 0) {
        toast.error("Choose at least one sales tax code.");
        return;
      }
      formData.set("applyTax", "true");
      formData.set("taxCodes", salesSelected.join(","));
      formData.set("provinceTaxCodes", provinceSelected.join(","));
    }
    if (applyTaxMode) {
      formData.set("applyTaxMode", "true");
      formData.set("taxMode", taxMode);
    }

    startTransition(async () => {
      const result = await bulkCategorizeAction(undefined, formData);
      if (result.ok) {
        toast.success(result.message ?? "Bulk edit applied");
        onClose();
      } else toast.error(result.error ?? "Bulk edit failed");
    });
  }

  return (
    <div className="modal open">
      <div className="modal-card" style={{ width: "min(760px, 96vw)" }}>
        <div className="modal-head">
          <h3>Bulk Edit Transactions</h3>
          <button type="button" className="btn-converter btn-light btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Apply changes to</label>
            <select value={scope} onChange={(e) => setScope(e.target.value as "selected" | "all")}>
              <option value="selected">Selected transactions ({selectedIds.length})</option>
              <option value="all">All transactions ({totalCount})</option>
            </select>
          </div>
          <div className="bulk-grid">
            <div className="field">
              <label className="bulk-check">
                <input
                  type="checkbox"
                  checked={applyPosting}
                  onChange={(e) => setApplyPosting(e.target.checked)}
                />
                Posting Bank / Credit Card Account
              </label>
              <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.type === "BANK" ? "Bank" : "Credit Card"})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="bulk-check">
                <input
                  type="checkbox"
                  checked={applyAccount}
                  onChange={(e) => setApplyAccount(e.target.checked)}
                />
                Account / Category
              </label>
              <select value={accountNumber} onChange={(e) => syncAccountFromNumber(e.target.value)}>
                <option value="">— Account number —</option>
                {accounts.map((a) => (
                  <option key={a.number} value={a.number}>
                    {a.number}
                  </option>
                ))}
              </select>
              <select
                className="mt-2"
                value={accountName}
                onChange={(e) => syncAccountFromName(e.target.value)}
              >
                <option value="">— Category / account —</option>
                {accounts.map((a) => (
                  <option key={`${a.number}-${a.name}`} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="bulk-check">
                <input
                  type="checkbox"
                  checked={applyProvince}
                  onChange={(e) => setApplyProvince(e.target.checked)}
                />
                Province / Apply PST
              </label>
              <select value={province} onChange={(e) => setProvince(e.target.value)}>
                <option value="">— Select province —</option>
                {CANADIAN_PROVINCES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {code} — {name}
                  </option>
                ))}
              </select>
              <p className="hint mt-1">
                Selecting a province applies its linked PST/QST/RST code and preserves GST/HST.
              </p>
            </div>
            <div className="field">
              <label className="bulk-check">
                <input
                  type="checkbox"
                  checked={applyTax}
                  onChange={(e) => setApplyTax(e.target.checked)}
                />
                Sales Tax Code(s)
              </label>
              <select
                multiple
                size={5}
                value={selectedTaxes}
                onChange={(e) => {
                  setSelectedTaxes(Array.from(e.target.selectedOptions, (o) => o.value));
                }}
              >
                {allTaxOptions.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="bulk-check">
                <input
                  type="checkbox"
                  checked={applyTaxMode}
                  onChange={(e) => setApplyTaxMode(e.target.checked)}
                />
                Tax Treatment
              </label>
              <select
                value={taxMode}
                onChange={(e) => setTaxMode(e.target.value as "INCLUSIVE" | "EXCLUSIVE")}
              >
                <option value="INCLUSIVE">Inclusive — amount includes tax</option>
                <option value="EXCLUSIVE">Exclusive — amount is before tax</option>
              </select>
            </div>
          </div>
          <p className="hint">
            Inclusive backs tax out of the transaction amount. Exclusive calculates tax on top of
            the entered amount. Net Amount is always the amount excluding tax.
          </p>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn-converter btn-light" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-converter btn-green"
            disabled={pending}
            onClick={apply}
          >
            Apply Bulk Edit
          </button>
        </div>
      </div>
    </div>
  );
}
