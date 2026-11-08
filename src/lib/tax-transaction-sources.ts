import { prisma } from "@/lib/db";
import { loadTransactionsForGeneralEntries } from "@/lib/general-entries-sources";
import { normalizeTaxCodeAssignment, type TxForTax } from "@/lib/tax-reports";

type TaxCatalogKind = "GST_HST" | "PST" | "OTHER" | "NONE";

/** Same saved-folder + unsaved-live merge as General Entries, mapped for GST/PST reports. */
export async function loadTransactionsForTaxReports(
  organizationId: string,
  range: { start: Date; end: Date } | null,
): Promise<{
  transactions: TxForTax[];
  transactionCount: number;
}> {
  const [merged, chart, taxCodes] = await Promise.all([
    loadTransactionsForGeneralEntries(prisma, organizationId),
    prisma.chartAccount.findMany({
      where: { organizationId },
      select: { number: true, name: true, type: true },
    }),
    prisma.taxCode.findMany({ where: { organizationId } }),
  ]);

  const catalog = taxCodes.map((t) => ({
    code: t.code,
    rate: Number(t.rate),
    kind: t.kind as TaxCatalogKind,
  }));

  const typeByNumber = new Map(chart.map((a) => [a.number, a.type]));
  const typeByName = new Map(chart.map((a) => [a.name, a.type]));

  const inRange = range
    ? merged.filter((tx) => tx.date >= range.start && tx.date <= range.end)
    : [];

  const transactions: TxForTax[] = inRange.map((tx) => {
    const normalized = normalizeTaxCodeAssignment(
      tx.taxCodes,
      tx.provinceTaxCodes ?? [],
      catalog,
    );
    const accountType =
      (tx.accountNumber ? typeByNumber.get(tx.accountNumber) : undefined) ??
      (tx.accountName ? typeByName.get(tx.accountName) : undefined) ??
      null;
    return {
      id: tx.id,
      date: tx.date,
      description: tx.description,
      moneyIn: tx.moneyIn,
      moneyOut: tx.moneyOut,
      accountNumber: tx.accountNumber,
      accountName: tx.accountName,
      accountType:
        accountType === "INCOME" ||
        accountType === "EXPENSE" ||
        accountType === "ASSET" ||
        accountType === "LIABILITY" ||
        accountType === "EQUITY"
          ? accountType
          : null,
      taxCodes: normalized.taxCodes,
      provinceTaxCodes: normalized.provinceTaxCodes,
      taxMode: tx.taxMode,
      transferMatchId: tx.transferMatchId,
      province: tx.province ?? null,
    };
  });

  return { transactions, transactionCount: transactions.length };
}
