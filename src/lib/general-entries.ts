export type GeTx = {
  id: string;
  date: Date;
  description: string;
  moneyIn: number;
  moneyOut: number;
  accountNumber: string | null;
  accountName: string | null;
  taxCodes: string[];
  taxMode: "INCLUSIVE" | "EXCLUSIVE" | "KEEP";
  transferMatchId?: string | null;
  bankAccountId: string;
  bankName: string;
  bankType: "BANK" | "CREDIT_CARD";
};

export type GeLine = {
  accountNumber: string | null;
  accountName: string;
  memo: string;
  debit: number;
  credit: number;
};

export type GeneratedEntry = {
  date: Date;
  memo: string;
  periodLabel: string;
  lines: GeLine[];
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function periodKey(date: Date, mode: "MONTHLY" | "QUARTERLY" | "YEARLY") {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  if (mode === "YEARLY") return `${y}`;
  if (mode === "QUARTERLY") return `${y}-Q${Math.ceil(m / 3)}`;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export type GePeriodType = "MONTHLY" | "QUARTERLY" | "YEARLY" | "CUSTOM";

/**
 * Generates simplified double-entry journals:
 * - Expense money-out: Dr Expense / Cr Bank
 * - Income money-in: Dr Bank / Cr Income
 * - Transfers skipped
 * Tax split is approximate using Inclusive/Exclusive rates sum on GST-like codes when provided via taxRateTotal.
 */
export function generateAutomaticEntries(
  transactions: GeTx[],
  options: {
    periodType: GePeriodType;
    taxRateByCode: Map<string, number>;
    customStart?: Date | null;
    customEnd?: Date | null;
    inputTaxAccount?: { number: string | null; name: string } | null;
    outputTaxAccount?: { number: string | null; name: string } | null;
  },
): GeneratedEntry[] {
  const inputTax = options.inputTaxAccount ?? {
    number: "2150",
    name: "GST/HST Recoverable (ITC)",
  };
  const outputTax = options.outputTaxAccount ?? {
    number: "2100",
    name: "GST/HST Payable",
  };

  const groups = new Map<string, GeTx[]>();

  for (const tx of transactions) {
    if (tx.transferMatchId) continue;
    if (!tx.accountName) continue;

    if (options.periodType === "CUSTOM") {
      const start = options.customStart;
      const end = options.customEnd;
      if (!start || !end) continue;
      const t = tx.date.getTime();
      if (t < start.getTime() || t > end.getTime()) continue;
      const key = `C:${start.toISOString().slice(0, 10)}:${end.toISOString().slice(0, 10)}`;
      const list = groups.get(key) ?? [];
      list.push(tx);
      groups.set(key, list);
      continue;
    }

    const key = periodKey(tx.date, options.periodType);
    const list = groups.get(key) ?? [];
    list.push(tx);
    groups.set(key, list);
  }

  const entries: GeneratedEntry[] = [];

  for (const [rawLabel, rows] of groups) {
    const label =
      options.periodType === "CUSTOM" && rawLabel.startsWith("C:")
        ? `Custom — ${rawLabel.slice(2).replace(":", " to ")}`
        : rawLabel;
    // Aggregate by category + bank
    type Agg = {
      accountNumber: string | null;
      accountName: string;
      bankName: string;
      bankNumberHint: string;
      expenseNet: number;
      incomeNet: number;
      taxOnExpenses: number;
      taxOnIncome: number;
      lastDate: Date;
    };
    const agg = new Map<string, Agg>();

    for (const tx of rows) {
      const rate = tx.taxCodes.reduce(
        (sum, code) => sum + (options.taxRateByCode.get(code) ?? 0),
        0,
      );
      const gross = tx.moneyOut > 0 ? tx.moneyOut : tx.moneyIn;
      let net = gross;
      let tax = 0;
      if (rate > 0) {
        if (tx.taxMode === "EXCLUSIVE") {
          tax = (gross * rate) / 100;
          net = gross;
        } else {
          tax = gross - gross / (1 + rate / 100);
          net = gross - tax;
        }
      }

      const key = `${tx.accountName}::${tx.bankAccountId}`;
      const current = agg.get(key) ?? {
        accountNumber: tx.accountNumber,
        accountName: tx.accountName!,
        bankName: tx.bankName,
        bankNumberHint: tx.bankAccountId.slice(-4),
        expenseNet: 0,
        incomeNet: 0,
        taxOnExpenses: 0,
        taxOnIncome: 0,
        lastDate: tx.date,
      };

      if (tx.moneyOut > 0) {
        current.expenseNet += net;
        current.taxOnExpenses += tax;
      } else {
        current.incomeNet += net;
        current.taxOnIncome += tax;
      }
      if (tx.date > current.lastDate) current.lastDate = tx.date;
      agg.set(key, current);
    }

    for (const row of agg.values()) {
      const lines: GeLine[] = [];
      if (row.expenseNet > 0) {
        lines.push({
          accountNumber: row.accountNumber,
          accountName: row.accountName,
          memo: `Expenses ${label}`,
          debit: round2(row.expenseNet),
          credit: 0,
        });
        if (row.taxOnExpenses > 0) {
          lines.push({
            accountNumber: inputTax.number,
            accountName: inputTax.name,
            memo: `ITC ${label}`,
            debit: round2(row.taxOnExpenses),
            credit: 0,
          });
        }
        lines.push({
          accountNumber: null,
          accountName: row.bankName,
          memo: `Payment from ${row.bankName}`,
          debit: 0,
          credit: round2(row.expenseNet + row.taxOnExpenses),
        });
      }
      if (row.incomeNet > 0) {
        lines.push({
          accountNumber: null,
          accountName: row.bankName,
          memo: `Deposit to ${row.bankName}`,
          debit: round2(row.incomeNet + row.taxOnIncome),
          credit: 0,
        });
        lines.push({
          accountNumber: row.accountNumber,
          accountName: row.accountName,
          memo: `Sales ${label}`,
          debit: 0,
          credit: round2(row.incomeNet),
        });
        if (row.taxOnIncome > 0) {
          lines.push({
            accountNumber: outputTax.number,
            accountName: outputTax.name,
            memo: `GST collected ${label}`,
            debit: 0,
            credit: round2(row.taxOnIncome),
          });
        }
      }

      if (!lines.length) continue;
      const debit = round2(lines.reduce((s, l) => s + l.debit, 0));
      const credit = round2(lines.reduce((s, l) => s + l.credit, 0));
      if (Math.abs(debit - credit) > 0.02) continue;

      entries.push({
        date: row.lastDate,
        memo: `${row.accountName} · ${label}`,
        periodLabel: label,
        lines,
      });
    }
  }

  return entries.sort((a, b) => a.date.getTime() - b.date.getTime());
}
