"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { bulkCategorizeAction } from "@/app/actions/books";
type Bank = { id: string; name: string; type: "BANK" | "CREDIT_CARD" };
type Account = { number: string; name: string };
type TaxOption = { code: string; kind?: string; name?: string };

export function BulkEditTransactionsModal({
  open,
  onClose,
  selectedIds,
  totalCount,
  banks,
  accounts,
  taxCodes,
  focusField = "all",
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: string[];
  totalCount: number;
  banks: Bank[];
  accounts: Account[];
  taxCodes: TaxOption[];
  taxCatalog?: unknown;
  focusField?: "all" | "account" | "salesTax" | "pst";
}) {
  const [pending, startTransition] = useTransition();
  const [scope, setScope] = useState<"selected" | "all">(
    selectedIds.length ? "selected" : "all",
  );
  const [applyPosting, setApplyPosting] = useState(false);
  const [applyAccount, setApplyAccount] = useState(false);
  const [applySalesTax, setApplySalesTax] = useState(false);
  const [applyPstTax, setApplyPstTax] = useState(false);
  const [applyTaxMode, setApplyTaxMode] = useState(false);
  const [bankAccountId, setBankAccountId] = useState(banks[0]?.id ?? "");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [selectedSalesTaxes, setSelectedSalesTaxes] = useState<string[]>([]);
  const [selectedPstTaxes, setSelectedPstTaxes] = useState<string[]>([]);
  const [taxMode, setTaxMode] = useState<"INCLUSIVE" | "EXCLUSIVE">("INCLUSIVE");

  const salesTaxOptions = useMemo(
    () =>
      taxCodes.filter(
        (t) => !t.kind || t.kind === "GST_HST" || t.kind === "NONE" || t.kind === "OTHER",
      ),
    [taxCodes],
  );
  const pstTaxOptions = useMemo(
    () => taxCodes.filter((t) => t.kind === "PST"),
    [taxCodes],
  );

  useEffect(() => {
    if (!open) return;
    setScope(selectedIds.length ? "selected" : "all");
    setApplyPosting(false);
    setApplyAccount(false);
    setApplyTaxMode(false);
    setSelectedSalesTaxes([]);
    setSelectedPstTaxes([]);
    setAccountNumber("");
    setAccountName("");
    if (focusField === "salesTax") {
      setApplyAccount(false);
      setApplySalesTax(true);
      setApplyPstTax(false);
    } else if (focusField === "pst") {
      setApplyAccount(false);
      setApplySalesTax(false);
      setApplyPstTax(true);
    } else if (focusField === "account") {
      setApplyAccount(true);
      setApplySalesTax(false);
      setApplyPstTax(false);
    } else {
      setApplyAccount(false);
      setApplySalesTax(false);
      setApplyPstTax(false);
    }
  }, [open, focusField, selectedIds.length]);

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
    const flags = [applyPosting, applyAccount, applySalesTax, applyPstTax, applyTaxMode];
    if (!flags.some(Boolean)) {
      toast.error("Choose at least one field to bulk edit.");
      return;
    }
    if (scope === "selected" && selectedIds.length === 0) {
      toast.error("No selected transactions to bulk edit.");
      return;
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
    if (applySalesTax) {
      formData.set("applySalesTax", "true");
      formData.set("taxCodes", selectedSalesTaxes.join(","));
    }
    if (applyPstTax) {
      formData.set("applyPstTax", "true");
      formData.set("provinceTaxCodes", selectedPstTaxes.join(","));
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

  const title =
    focusField === "salesTax"
      ? "Bulk Edit Sales Tax Code"
      : focusField === "pst"
        ? "Bulk Edit PST Code"
        : focusField === "account"
          ? "Bulk Edit Account / Category"
          : "Bulk Edit Transactions";

  return (
    <div className="modal open">
      <div className="modal-card" style={{ width: "min(760px, 96vw)" }}>
        <div className="modal-head">
          <h3>{title}</h3>
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
            {focusField === "all" ? (
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
            ) : null}

            {focusField === "all" || focusField === "account" ? (
              <div className="field">
                <label className="bulk-check">
                  <input
                    type="checkbox"
                    checked={applyAccount}
                    onChange={(e) => setApplyAccount(e.target.checked)}
                  />
                  Account / Category
                </label>
                <select
                  value={accountNumber}
                  onChange={(e) => {
                    syncAccountFromNumber(e.target.value);
                    setApplyAccount(true);
                  }}
                >
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
                  onChange={(e) => {
                    syncAccountFromName(e.target.value);
                    setApplyAccount(true);
                  }}
                >
                  <option value="">— Category / account —</option>
                  {accounts.map((a) => (
                    <option key={`${a.number}-${a.name}`} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                </select>
                {focusField === "account" ? (
                  <p className="hint mt-1">
                    Sets Account Number and Category / Account on the chosen transactions. Leave
                    blank to clear.
                  </p>
                ) : null}
              </div>
            ) : null}

            {focusField === "all" || focusField === "salesTax" ? (
              <div className="field">
                <label className="bulk-check">
                  <input
                    type="checkbox"
                    checked={applySalesTax}
                    onChange={(e) => setApplySalesTax(e.target.checked)}
                  />
                  Sales Tax Code — GST / HST only
                </label>
                <select
                  multiple
                  size={6}
                  value={selectedSalesTaxes}
                  onChange={(e) => {
                    setSelectedSalesTaxes(Array.from(e.target.selectedOptions, (o) => o.value));
                    setApplySalesTax(true);
                  }}
                >
                  {salesTaxOptions.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.code}
                      {t.name ? ` — ${t.name}` : ""}
                    </option>
                  ))}
                </select>
                <p className="hint mt-1">Province PST/QST/RST codes are not listed here.</p>
              </div>
            ) : null}

            {focusField === "all" || focusField === "pst" ? (
              <div className="field">
                <label className="bulk-check">
                  <input
                    type="checkbox"
                    checked={applyPstTax}
                    onChange={(e) => setApplyPstTax(e.target.checked)}
                  />
                  PST Code — province tax only
                </label>
                <select
                  multiple
                  size={6}
                  value={selectedPstTaxes}
                  onChange={(e) => {
                    setSelectedPstTaxes(Array.from(e.target.selectedOptions, (o) => o.value));
                    setApplyPstTax(true);
                  }}
                >
                  {pstTaxOptions.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.code}
                      {t.name ? ` — ${t.name}` : ""}
                    </option>
                  ))}
                </select>
                <p className="hint mt-1">These feed PST Calculation only.</p>
              </div>
            ) : null}

            {focusField === "all" ? (
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
            ) : null}
          </div>
          <p className="hint">
            GST/HST and PST are stored separately so GST Calculation and PST Calculation stay
            accurate.
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
