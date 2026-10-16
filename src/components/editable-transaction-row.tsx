"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  updateTransactionCategoryAction,
  type TransactionRowPatch,
} from "@/app/actions/saves";
import { CANADIAN_PROVINCES, normalizeProvince } from "@/lib/canada-provinces";
import { calculateTransactionAmounts } from "@/lib/transaction-math";
import type { TaxCodeInfo } from "@/lib/tax-reports";

type Bank = { id: string; name: string; type: "BANK" | "CREDIT_CARD" };

type TxRow = {
  id: string;
  bankAccountId: string;
  date: string;
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
  bankName?: string;
  bankType?: "BANK" | "CREDIT_CARD";
};

function EditableTransactionRowInner({
  tx,
  rowIndex,
  canEdit,
  selected,
  onToggle,
  onPatched,
  onDirtyChange,
  registerRowSaver,
  unregisterRowSaver,
  onOpenTaxPicker,
  onCopyRow,
  onDeleteRow,
  accounts,
  banks,
  taxCatalog,
  provinceTaxByProvince,
}: {
  tx: TxRow;
  rowIndex: number;
  canEdit: boolean;
  selected: boolean;
  onToggle: () => void;
  onPatched?: (patch: TransactionRowPatch) => void;
  onDirtyChange?: (id: string, dirty: boolean) => void;
  registerRowSaver?: (id: string, saver: () => Promise<boolean>) => void;
  unregisterRowSaver?: (id: string) => void;
  onOpenTaxPicker?: () => void;
  onCopyRow?: () => void;
  onDeleteRow?: () => void;
  accounts: Array<{ number: string; name: string }>;
  banks: Bank[];
  taxCatalog: TaxCodeInfo[];
  provinceTaxByProvince: Map<string, string>;
}) {
  const [statementType, setStatementType] = useState<"Bank" | "Credit Card">(
    tx.bankType === "CREDIT_CARD" ? "Credit Card" : "Bank",
  );
  const [bankAccountId, setBankAccountId] = useState(tx.bankAccountId);
  const [date, setDate] = useState(tx.date);
  const [description, setDescription] = useState(tx.description);
  const [moneyIn, setMoneyIn] = useState(tx.moneyIn ? String(tx.moneyIn) : "");
  const [moneyOut, setMoneyOut] = useState(tx.moneyOut ? String(tx.moneyOut) : "");
  const [accountNumber, setAccountNumber] = useState(tx.accountNumber ?? "");
  const [accountName, setAccountName] = useState(tx.accountName ?? "");
  const [province, setProvince] = useState(tx.province ?? "");
  const [localTaxCodes, setLocalTaxCodes] = useState(tx.taxCodes);
  const [localProvinceTaxCodes, setLocalProvinceTaxCodes] = useState(tx.provinceTaxCodes);
  const [taxMode, setTaxMode] = useState(tx.taxMode === "EXCLUSIVE" ? "EXCLUSIVE" : "INCLUSIVE");
  const [notes, setNotes] = useState(tx.notes ?? "");

  useEffect(() => {
    setStatementType(tx.bankType === "CREDIT_CARD" ? "Credit Card" : "Bank");
    setBankAccountId(tx.bankAccountId);
    setDate(tx.date);
    setDescription(tx.description);
    setMoneyIn(tx.moneyIn ? String(tx.moneyIn) : "");
    setMoneyOut(tx.moneyOut ? String(tx.moneyOut) : "");
    setAccountNumber(tx.accountNumber ?? "");
    setAccountName(tx.accountName ?? "");
    setProvince(tx.province ?? "");
    setLocalTaxCodes(tx.taxCodes);
    setLocalProvinceTaxCodes(tx.provinceTaxCodes);
    setTaxMode(tx.taxMode === "EXCLUSIVE" ? "EXCLUSIVE" : "INCLUSIVE");
    setNotes(tx.notes ?? "");
  }, [tx]);

  const postingBanks = useMemo(
    () =>
      banks.filter((b) =>
        statementType === "Credit Card" ? b.type === "CREDIT_CARD" : b.type === "BANK",
      ),
    [banks, statementType],
  );

  const calc = useMemo(
    () =>
      calculateTransactionAmounts(
        {
          moneyIn: Number(moneyIn) || 0,
          moneyOut: Number(moneyOut) || 0,
          taxCodes: localTaxCodes,
          provinceTaxCodes: localProvinceTaxCodes,
          taxMode: taxMode as "INCLUSIVE" | "EXCLUSIVE",
        },
        taxCatalog,
      ),
    [moneyIn, moneyOut, localTaxCodes, localProvinceTaxCodes, taxMode, taxCatalog],
  );

  const taxLabel =
    [...localTaxCodes, ...localProvinceTaxCodes].filter(Boolean).join(" + ") || "Select tax";

  const isDirty = useMemo(() => {
    const stmtDirty =
      (statementType === "Credit Card" ? "CREDIT_CARD" : "BANK") !==
      (tx.bankType === "CREDIT_CARD" ? "CREDIT_CARD" : "BANK");
    return (
      stmtDirty ||
      bankAccountId !== tx.bankAccountId ||
      date !== tx.date ||
      description !== tx.description ||
      (Number(moneyIn) || 0) !== tx.moneyIn ||
      (Number(moneyOut) || 0) !== tx.moneyOut ||
      (accountNumber || "") !== (tx.accountNumber ?? "") ||
      (accountName || "") !== (tx.accountName ?? "") ||
      (province || "") !== (tx.province ?? "") ||
      taxMode !== (tx.taxMode === "EXCLUSIVE" ? "EXCLUSIVE" : "INCLUSIVE") ||
      (notes || "") !== (tx.notes ?? "") ||
      localTaxCodes.join("|") !== tx.taxCodes.join("|") ||
      localProvinceTaxCodes.join("|") !== tx.provinceTaxCodes.join("|")
    );
  }, [
    statementType,
    bankAccountId,
    date,
    description,
    moneyIn,
    moneyOut,
    accountNumber,
    accountName,
    province,
    taxMode,
    notes,
    localTaxCodes,
    localProvinceTaxCodes,
    tx,
  ]);

  useEffect(() => {
    onDirtyChange?.(tx.id, isDirty);
  }, [tx.id, isDirty, onDirtyChange]);

  const buildFormData = useCallback(() => {
    const formData = new FormData();
    formData.set("inline", "true");
    formData.set("id", tx.id);
    formData.set("date", date);
    formData.set("description", description);
    formData.set("moneyIn", moneyIn || "0");
    formData.set("moneyOut", moneyOut || "0");
    formData.set("accountNumber", accountNumber);
    formData.set(
      "account",
      accountName ? `${accountNumber}||${accountName}` : accountNumber ? `${accountNumber}||` : "",
    );
    formData.set("province", province);
    formData.set("taxCodes", localTaxCodes.join(","));
    formData.set("provinceTaxCodes", localProvinceTaxCodes.join(","));
    formData.set("taxMode", taxMode);
    formData.set("notes", notes);
    formData.set("bankAccountId", bankAccountId);
    return formData;
  }, [
    tx.id,
    date,
    description,
    moneyIn,
    moneyOut,
    accountNumber,
    accountName,
    province,
    localTaxCodes,
    localProvinceTaxCodes,
    taxMode,
    notes,
    bankAccountId,
  ]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (!canEdit) return false;
    const formData = buildFormData();
    const result = await updateTransactionCategoryAction(undefined, formData);
    if (result.ok && result.patch) {
      onPatched?.(result.patch);
      return true;
    }
    toast.error(result.error ?? "Save failed");
    return false;
  }, [canEdit, buildFormData, onPatched]);

  const saveRef = useRef(saveNow);
  saveRef.current = saveNow;

  useEffect(() => {
    if (!registerRowSaver) return;
    registerRowSaver(tx.id, () => saveRef.current());
    return () => unregisterRowSaver?.(tx.id);
  }, [tx.id, registerRowSaver, unregisterRowSaver]);

  function onProvinceChange(code: string) {
    const p = normalizeProvince(code);
    setProvince(p);
    const linked = provinceTaxByProvince.get(p);
    if (linked) setLocalProvinceTaxCodes([linked]);
  }

  return (
    <tr className={isDirty ? "tx-row-dirty" : undefined}>
      {canEdit ? (
        <td className="col-check">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${description}`}
          />
        </td>
      ) : null}
      <td className="col-idx">{rowIndex + 1}</td>
      <td className="col-stmt">
        {canEdit ? (
          <select
            value={statementType}
            onChange={(e) => {
              const v = e.target.value as "Bank" | "Credit Card";
              setStatementType(v);
              const next = banks.find((b) =>
                v === "Credit Card" ? b.type === "CREDIT_CARD" : b.type === "BANK",
              );
              if (next) setBankAccountId(next.id);
            }}
          >
            <option value="Bank">Bank</option>
            <option value="Credit Card">Credit Card</option>
          </select>
        ) : statementType === "Credit Card" ? (
          "Credit Card"
        ) : (
          "Bank"
        )}
      </td>
      <td className="posting-acct col-posting">
        {canEdit ? (
          <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            {postingBanks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : (
          tx.bankName ?? "—"
        )}
      </td>
      <td className="date col-date">
        {canEdit ? (
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        ) : (
          date
        )}
      </td>
      <td className="desc col-desc">
        {canEdit ? (
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
        ) : (
          description
        )}
      </td>
      <td className="num money-in col-money">
        {canEdit ? (
          <input
            type="number"
            step="0.01"
            min="0"
            value={moneyIn}
            onChange={(e) => setMoneyIn(e.target.value)}
          />
        ) : moneyIn ? `$${Number(moneyIn).toFixed(2)}` : ""}
      </td>
      <td className="num money-out col-money">
        {canEdit ? (
          <input
            type="number"
            step="0.01"
            min="0"
            value={moneyOut}
            onChange={(e) => setMoneyOut(e.target.value)}
          />
        ) : moneyOut ? `$${Number(moneyOut).toFixed(2)}` : ""}
      </td>
      <td className="acctnum col-acctnum">
        {canEdit ? (
          <select
            value={accountNumber}
            onChange={(e) => {
              const num = e.target.value;
              const ac = accounts.find((a) => a.number === num);
              setAccountNumber(num);
              if (ac) setAccountName(ac.name);
            }}
          >
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={a.number} value={a.number}>
                {a.number}
              </option>
            ))}
          </select>
        ) : (
          accountNumber || "—"
        )}
      </td>
      <td className="acct col-acct">
        {canEdit ? (
          <select
            value={accountName}
            onChange={(e) => {
              const name = e.target.value;
              const ac = accounts.find((a) => a.name === name);
              setAccountName(name);
              if (ac) setAccountNumber(ac.number);
            }}
          >
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={`${a.number}-${a.name}`} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        ) : (
          accountName || "—"
        )}
      </td>
      <td className="col-province">
        {canEdit ? (
          <select value={province} onChange={(e) => onProvinceChange(e.target.value)}>
            <option value="">—</option>
            {CANADIAN_PROVINCES.map(([code, name]) => (
              <option key={code} value={code}>
                {code} — {name}
              </option>
            ))}
          </select>
        ) : (
          province || "—"
        )}
      </td>
      <td className="taxcell">
        {canEdit ? (
          <button type="button" className="taxbtn" title={taxLabel} onClick={onOpenTaxPicker}>
            {taxLabel}
          </button>
        ) : taxLabel === "Select tax" ? (
          "—"
        ) : (
          taxLabel
        )}
      </td>
      <td className="taxmode col-taxmode">
        {canEdit ? (
          <select
            value={taxMode}
            onChange={(e) => setTaxMode(e.target.value as "INCLUSIVE" | "EXCLUSIVE")}
          >
            <option value="INCLUSIVE">Inclusive</option>
            <option value="EXCLUSIVE">Exclusive</option>
          </select>
        ) : taxMode === "EXCLUSIVE" ? (
          "Exclusive"
        ) : (
          "Inclusive"
        )}
      </td>
      <td className="num col-amt" data-taxamt={tx.id}>
        ${calc.taxAmount.toFixed(2)}
      </td>
      <td className="num col-amt" data-netamt={tx.id}>
        ${calc.netAmount.toFixed(2)}
      </td>
      <td>
        {canEdit ? (
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
        ) : (
          notes
        )}
      </td>
      <td className="row-actions">
        {canEdit ? (
          <>
            <button type="button" className="btn-converter btn-light btn-sm" onClick={onCopyRow}>
              Copy
            </button>{" "}
            <button type="button" className="btn-converter btn-danger btn-sm" onClick={onDeleteRow}>
              Delete
            </button>
          </>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

export const EditableTransactionRow = memo(EditableTransactionRowInner);
