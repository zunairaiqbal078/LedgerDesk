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

type Bank = {
  id: string;
  name: string;
  type: "BANK" | "CREDIT_CARD";
  glAccountNumber?: string | null;
  glAccountName?: string | null;
};

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
  salesTaxAmountOverride?: number | null;
  provinceTaxAmountOverride?: number | null;
  notes: string | null;
  bankName?: string;
  bankType?: "BANK" | "CREDIT_CARD";
};

function parseTaxField(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function resolveTaxOverride(input: string, autoAmount: number): number | null {
  const n = parseTaxField(input);
  if (n == null) return null;
  if (Math.abs(n - autoAmount) < 0.005) return null;
  return n;
}

type PersistOverrides = {
  bankAccountId?: string;
  date?: string;
  description?: string;
  moneyIn?: string;
  moneyOut?: string;
  accountNumber?: string;
  accountName?: string;
  province?: string;
  taxCodes?: string[];
  provinceTaxCodes?: string[];
  taxMode?: "INCLUSIVE" | "EXCLUSIVE";
  notes?: string;
  salesTaxAmountOverride?: number | null;
  provinceTaxAmountOverride?: number | null;
};

function EditableTransactionRowInner({
  tx,
  rowIndex,
  canEdit,
  selected,
  onToggle,
  onPatched,
  onOpenGstTaxPicker,
  onOpenPstTaxPicker,
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
  onOpenGstTaxPicker?: () => void;
  onOpenPstTaxPicker?: () => void;
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
  const [salesTaxAmount, setSalesTaxAmount] = useState("");
  const [provinceTaxAmount, setProvinceTaxAmount] = useState("");
  const [notes, setNotes] = useState(tx.notes ?? "");
  const savingRef = useRef(false);

  const calcBase = useMemo(
    () => ({
      moneyIn: Number(moneyIn) || 0,
      moneyOut: Number(moneyOut) || 0,
      taxCodes: localTaxCodes,
      provinceTaxCodes: localProvinceTaxCodes,
      taxMode: taxMode as "INCLUSIVE" | "EXCLUSIVE",
    }),
    [moneyIn, moneyOut, localTaxCodes, localProvinceTaxCodes, taxMode],
  );

  const calcAuto = useMemo(
    () =>
      calculateTransactionAmounts(
        { ...calcBase, salesTaxAmountOverride: null, provinceTaxAmountOverride: null },
        taxCatalog,
      ),
    [calcBase, taxCatalog],
  );

  const calc = useMemo(
    () =>
      calculateTransactionAmounts(
        {
          ...calcBase,
          salesTaxAmountOverride: parseTaxField(salesTaxAmount),
          provinceTaxAmountOverride: parseTaxField(provinceTaxAmount),
        },
        taxCatalog,
      ),
    [calcBase, salesTaxAmount, provinceTaxAmount, taxCatalog],
  );

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
    setTaxMode(tx.taxMode === "EXCLUSIVE" ? "EXCLUSIVE" : "INCLUSIVE");
    setNotes(tx.notes ?? "");
  }, [
    tx.id,
    tx.bankType,
    tx.bankAccountId,
    tx.date,
    tx.description,
    tx.moneyIn,
    tx.moneyOut,
    tx.accountNumber,
    tx.accountName,
    tx.province,
    tx.taxMode,
    tx.salesTaxAmountOverride,
    tx.provinceTaxAmountOverride,
    tx.notes,
  ]);

  useEffect(() => {
    setSalesTaxAmount(
      tx.salesTaxAmountOverride != null
        ? tx.salesTaxAmountOverride.toFixed(2)
        : calcAuto.salesTaxCalculated.toFixed(2),
    );
    setProvinceTaxAmount(
      tx.provinceTaxAmountOverride != null
        ? tx.provinceTaxAmountOverride.toFixed(2)
        : calcAuto.provinceTaxCalculated.toFixed(2),
    );
  }, [
    tx.id,
    tx.salesTaxAmountOverride,
    tx.provinceTaxAmountOverride,
    calcAuto.salesTaxCalculated,
    calcAuto.provinceTaxCalculated,
  ]);

  const taxCodesKey = tx.taxCodes.join("|");
  const provinceTaxCodesKey = tx.provinceTaxCodes.join("|");

  useEffect(() => {
    setLocalTaxCodes(tx.taxCodes);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync when codes change
  }, [tx.id, taxCodesKey]);

  useEffect(() => {
    setLocalProvinceTaxCodes(tx.provinceTaxCodes);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync when codes change
  }, [tx.id, provinceTaxCodesKey]);

  const postingBanks = useMemo(
    () =>
      banks.filter((b) =>
        statementType === "Credit Card" ? b.type === "CREDIT_CARD" : b.type === "BANK",
      ),
    [banks, statementType],
  );

  const gstLabel = localTaxCodes.filter(Boolean).join(" + ") || "Select Sales Tax Code";
  const pstLabel = localProvinceTaxCodes.filter(Boolean).join(" + ") || "Select PST Code";

  const persist = useCallback(
    async (overrides: PersistOverrides = {}) => {
      if (!canEdit || savingRef.current) return;
      const nextBank = overrides.bankAccountId ?? bankAccountId;
      const nextDate = overrides.date ?? date;
      const nextDesc = overrides.description ?? description;
      const nextIn = overrides.moneyIn ?? moneyIn;
      const nextOut = overrides.moneyOut ?? moneyOut;
      const nextAcctNum = overrides.accountNumber ?? accountNumber;
      const nextAcctName = overrides.accountName ?? accountName;
      const nextProvince = overrides.province ?? province;
      const nextSales = overrides.taxCodes ?? localTaxCodes;
      const nextPst = overrides.provinceTaxCodes ?? localProvinceTaxCodes;
      const nextMode = overrides.taxMode ?? taxMode;
      const nextNotes = overrides.notes ?? notes;

      const taxBasisChanged =
        (Number(nextIn) || 0) !== tx.moneyIn ||
        (Number(nextOut) || 0) !== tx.moneyOut ||
        nextMode !== (tx.taxMode === "EXCLUSIVE" ? "EXCLUSIVE" : "INCLUSIVE") ||
        nextSales.join("|") !== tx.taxCodes.join("|") ||
        nextPst.join("|") !== tx.provinceTaxCodes.join("|");

      const nextSalesTaxOverride = taxBasisChanged
        ? null
        : overrides.salesTaxAmountOverride !== undefined
          ? overrides.salesTaxAmountOverride
          : resolveTaxOverride(salesTaxAmount, calcAuto.salesTaxCalculated);
      const nextPstOverride = taxBasisChanged
        ? null
        : overrides.provinceTaxAmountOverride !== undefined
          ? overrides.provinceTaxAmountOverride
          : resolveTaxOverride(provinceTaxAmount, calcAuto.provinceTaxCalculated);

      const unchanged =
        nextBank === tx.bankAccountId &&
        nextDate === tx.date &&
        nextDesc === tx.description &&
        (Number(nextIn) || 0) === tx.moneyIn &&
        (Number(nextOut) || 0) === tx.moneyOut &&
        (nextAcctNum || "") === (tx.accountNumber ?? "") &&
        (nextAcctName || "") === (tx.accountName ?? "") &&
        (nextProvince || "") === (tx.province ?? "") &&
        nextMode === (tx.taxMode === "EXCLUSIVE" ? "EXCLUSIVE" : "INCLUSIVE") &&
        (nextNotes || "") === (tx.notes ?? "") &&
        nextSales.join("|") === tx.taxCodes.join("|") &&
        nextPst.join("|") === tx.provinceTaxCodes.join("|") &&
        (nextSalesTaxOverride ?? null) === (tx.salesTaxAmountOverride ?? null) &&
        (nextPstOverride ?? null) === (tx.provinceTaxAmountOverride ?? null);
      if (unchanged) return;

      savingRef.current = true;
      const formData = new FormData();
      formData.set("inline", "true");
      formData.set("id", tx.id);
      formData.set("date", nextDate);
      formData.set("description", nextDesc);
      formData.set("moneyIn", nextIn || "0");
      formData.set("moneyOut", nextOut || "0");
      formData.set("accountNumber", nextAcctNum);
      formData.set(
        "account",
        nextAcctName
          ? `${nextAcctNum}||${nextAcctName}`
          : nextAcctNum
            ? `${nextAcctNum}||`
            : "",
      );
      formData.set("province", nextProvince);
      formData.set("taxCodes", nextSales.join(","));
      formData.set("provinceTaxCodes", nextPst.join(","));
      formData.set("taxMode", nextMode);
      formData.set("notes", nextNotes);
      formData.set("bankAccountId", nextBank);
      if (taxBasisChanged) {
        formData.set("clearTaxAmountOverrides", "true");
      } else {
        formData.set(
          "salesTaxAmountOverride",
          nextSalesTaxOverride == null ? "" : String(nextSalesTaxOverride),
        );
        formData.set(
          "provinceTaxAmountOverride",
          nextPstOverride == null ? "" : String(nextPstOverride),
        );
      }
      try {
        const result = await updateTransactionCategoryAction(undefined, formData);
        if (result.ok && result.patch) {
          onPatched?.(result.patch);
        } else {
          toast.error(result.error ?? "Save failed");
        }
      } finally {
        savingRef.current = false;
      }
    },
    [
      canEdit,
      bankAccountId,
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
      salesTaxAmount,
      provinceTaxAmount,
      calcAuto.salesTaxCalculated,
      calcAuto.provinceTaxCalculated,
      notes,
      tx,
      onPatched,
    ],
  );

  function onProvinceChange(code: string) {
    const raw = code.trim();
    if (!raw) {
      setProvince("");
      setLocalProvinceTaxCodes([]);
      void persist({ province: "", provinceTaxCodes: [] });
      return;
    }
    const p = normalizeProvince(raw);
    setProvince(p);
    const linked = provinceTaxByProvince.get(p);
    if (linked) {
      setLocalProvinceTaxCodes([linked]);
      void persist({ province: p, provinceTaxCodes: [linked] });
    } else {
      void persist({ province: p });
    }
  }

  return (
    <tr>
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
              if (next) {
                setBankAccountId(next.id);
                void persist({ bankAccountId: next.id });
              }
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
          <select
            value={bankAccountId}
            onChange={(e) => {
              const v = e.target.value;
              setBankAccountId(v);
              const bank = banks.find((b) => b.id === v);
              const patch: PersistOverrides = { bankAccountId: v };
              const glNum = bank?.glAccountNumber?.trim();
              if (glNum) {
                patch.accountNumber = glNum;
                patch.accountName = bank?.glAccountName?.trim() || bank?.name || "";
                setAccountNumber(glNum);
                setAccountName(patch.accountName ?? "");
              }
              void persist(patch);
            }}
          >
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
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            onBlur={() => void persist()}
          />
        ) : (
          date
        )}
      </td>
      <td className="desc col-desc">
        {canEdit ? (
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => void persist()}
          />
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
            onBlur={() => void persist()}
          />
        ) : moneyIn ? (
          `$${Number(moneyIn).toFixed(2)}`
        ) : (
          ""
        )}
      </td>
      <td className="num money-out col-money">
        {canEdit ? (
          <input
            type="number"
            step="0.01"
            min="0"
            value={moneyOut}
            onChange={(e) => setMoneyOut(e.target.value)}
            onBlur={() => void persist()}
          />
        ) : moneyOut ? (
          `$${Number(moneyOut).toFixed(2)}`
        ) : (
          ""
        )}
      </td>
      <td className="acctnum col-acctnum">
        {canEdit ? (
          <select
            value={accountNumber}
            onChange={(e) => {
              const num = e.target.value;
              const ac = accounts.find((a) => a.number === num);
              const name = ac?.name ?? "";
              setAccountNumber(num);
              if (ac) setAccountName(ac.name);
              else if (!num) setAccountName("");
              void persist({ accountNumber: num, accountName: ac ? name : num ? accountName : "" });
            }}
          >
            <option value="">None</option>
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
              const num = ac?.number ?? "";
              setAccountName(name);
              if (ac) setAccountNumber(ac.number);
              else if (!name) setAccountNumber("");
              void persist({
                accountName: name,
                accountNumber: ac ? num : name ? accountNumber : "",
              });
            }}
          >
            <option value="">None</option>
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
            <option value="">None</option>
            {CANADIAN_PROVINCES.map(([code, name]) => (
              <option key={code} value={code}>
                {code} — {name}
              </option>
            ))}
          </select>
        ) : (
          province || "None"
        )}
      </td>
      <td className="taxcell col-tax">
        {canEdit ? (
          <button
            type="button"
            className="taxbtn"
            title={gstLabel}
            onClick={onOpenGstTaxPicker}
          >
            {gstLabel}
          </button>
        ) : gstLabel === "Select Sales Tax Code" ? (
          "—"
        ) : (
          gstLabel
        )}
      </td>
      <td className="taxcell col-tax">
        {canEdit ? (
          <button
            type="button"
            className="taxbtn"
            title={pstLabel}
            onClick={onOpenPstTaxPicker}
          >
            {pstLabel}
          </button>
        ) : pstLabel === "Select PST Code" ? (
          "—"
        ) : (
          pstLabel
        )}
      </td>
      <td className="taxmode col-taxmode">
        {canEdit ? (
          <select
            value={taxMode}
            onChange={(e) => {
              const v = e.target.value as "INCLUSIVE" | "EXCLUSIVE";
              setTaxMode(v);
              void persist({ taxMode: v });
            }}
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
      <td className="num col-amt" data-salestaxamt={tx.id}>
        {canEdit ? (
          <input
            type="number"
            step="0.01"
            min="0"
            value={salesTaxAmount}
            onChange={(e) => setSalesTaxAmount(e.target.value)}
            onBlur={() => void persist()}
            title={
              tx.salesTaxAmountOverride != null
                ? "Manual sales tax amount (auto-recalc when amount or tax codes change)"
                : "From sales tax codes — edit to override"
            }
          />
        ) : (
          `$${calc.salesTaxAmount.toFixed(2)}`
        )}
      </td>
      <td className="num col-amt" data-pstamt={tx.id}>
        {canEdit ? (
          <input
            type="number"
            step="0.01"
            min="0"
            value={provinceTaxAmount}
            onChange={(e) => setProvinceTaxAmount(e.target.value)}
            onBlur={() => void persist()}
            title={
              tx.provinceTaxAmountOverride != null
                ? "Manual PST amount (auto-recalc when amount or tax codes change)"
                : "From PST code — edit to override"
            }
          />
        ) : (
          `$${calc.provinceTaxAmount.toFixed(2)}`
        )}
      </td>
      <td className="num col-amt" data-netamt={tx.id}>
        ${calc.netAmount.toFixed(2)}
      </td>
      <td>
        {canEdit ? (
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => void persist()}
          />
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
