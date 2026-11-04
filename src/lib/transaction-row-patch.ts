import type { Prisma } from "@prisma/client";

/** Manual GST/PST amounts on a transaction row (schema: Transaction.sales/provinceTaxAmountOverride). */
export type TaxAmountOverrideUpdate = {
  salesTaxAmountOverride?: number | null;
  provinceTaxAmountOverride?: number | null;
};

export function taxAmountOverrideUpdate(
  clear: boolean,
  sales: number | null | undefined,
  pst: number | null | undefined,
): TaxAmountOverrideUpdate {
  if (clear) {
    return { salesTaxAmountOverride: null, provinceTaxAmountOverride: null };
  }
  const patch: TaxAmountOverrideUpdate = {};
  if (sales !== undefined) patch.salesTaxAmountOverride = sales;
  if (pst !== undefined) patch.provinceTaxAmountOverride = pst;
  return patch;
}

export type TransactionRowPatch = {
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
  salesTaxAmountOverride: number | null;
  provinceTaxAmountOverride: number | null;
  notes: string | null;
  bankName: string;
  bankType: "BANK" | "CREDIT_CARD";
};

/** Fields returned after inline transaction row saves (keep in sync with Prisma schema). */
export const transactionPatchSelect = {
  id: true,
  bankAccountId: true,
  date: true,
  description: true,
  moneyIn: true,
  moneyOut: true,
  accountNumber: true,
  accountName: true,
  province: true,
  taxCodes: true,
  provinceTaxCodes: true,
  taxMode: true,
  salesTaxAmountOverride: true,
  provinceTaxAmountOverride: true,
  notes: true,
  bankAccount: { select: { name: true, type: true } },
} satisfies Prisma.TransactionSelect;

export type TransactionPatchRow = Prisma.TransactionGetPayload<{
  select: typeof transactionPatchSelect;
}>;

export function toTransactionRowPatch(row: TransactionPatchRow): TransactionRowPatch {
  return {
    id: row.id,
    bankAccountId: row.bankAccountId,
    date: row.date.toISOString().slice(0, 10),
    description: row.description,
    moneyIn: Number(row.moneyIn),
    moneyOut: Number(row.moneyOut),
    accountNumber: row.accountNumber,
    accountName: row.accountName,
    province: row.province,
    taxCodes: row.taxCodes,
    provinceTaxCodes: row.provinceTaxCodes,
    taxMode: row.taxMode,
    salesTaxAmountOverride:
      row.salesTaxAmountOverride != null ? Number(row.salesTaxAmountOverride) : null,
    provinceTaxAmountOverride:
      row.provinceTaxAmountOverride != null ? Number(row.provinceTaxAmountOverride) : null,
    notes: row.notes,
    bankName: row.bankAccount.name,
    bankType: row.bankAccount.type,
  };
}
