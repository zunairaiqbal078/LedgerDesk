import type { TaxCodeInfo } from "@/lib/tax-reports";

export type TxCalcInput = {
  moneyIn: number;
  moneyOut: number;
  taxCodes: string[];
  provinceTaxCodes?: string[];
  taxMode: "INCLUSIVE" | "EXCLUSIVE" | "KEEP";
};

export function resolveTaxRate(
  selectedCodes: string[],
  catalog: TaxCodeInfo[],
): number {
  const map = new Map(catalog.map((t) => [t.code, Number(t.rate)]));
  return selectedCodes.reduce((sum, code) => sum + (map.get(code) ?? 0), 0);
}

function taxAmountForRate(
  gross: number,
  rate: number,
  mode: "INCLUSIVE" | "EXCLUSIVE",
) {
  if (rate <= 0 || gross <= 0) return 0;
  if (mode === "EXCLUSIVE") return round2((gross * rate) / 100);
  return round2(gross - gross / (1 + rate / 100));
}

export function calculateTransactionAmounts(
  input: TxCalcInput,
  catalog: TaxCodeInfo[],
) {
  const gross = input.moneyIn > 0 ? input.moneyIn : input.moneyOut;
  const side: "in" | "out" = input.moneyIn > 0 ? "in" : "out";
  const provinceCodes = input.provinceTaxCodes ?? [];
  const salesRate = resolveTaxRate(input.taxCodes, catalog);
  const provinceRate = resolveTaxRate(provinceCodes, catalog);
  const combinedRate = salesRate + provinceRate;
  const mode = input.taxMode === "EXCLUSIVE" ? "EXCLUSIVE" : "INCLUSIVE";

  let salesTaxAmount = 0;
  let provinceTaxAmount = 0;
  let taxAmount = 0;
  let netAmount = round2(gross);

  if (combinedRate > 0 && gross > 0) {
    if (mode === "EXCLUSIVE") {
      salesTaxAmount = taxAmountForRate(gross, salesRate, mode);
      provinceTaxAmount = taxAmountForRate(gross, provinceRate, mode);
      taxAmount = round2(salesTaxAmount + provinceTaxAmount);
      netAmount = round2(gross);
    } else {
      // Inclusive: extract each component proportionally from embedded tax
      taxAmount = taxAmountForRate(gross, combinedRate, mode);
      if (combinedRate > 0) {
        salesTaxAmount = round2(taxAmount * (salesRate / combinedRate));
        provinceTaxAmount = round2(taxAmount - salesTaxAmount);
      }
      netAmount = round2(gross - taxAmount);
    }
  }

  return {
    gross: round2(gross),
    salesTaxAmount,
    provinceTaxAmount,
    taxAmount,
    netAmount,
    salesRate,
    provinceRate,
    rate: combinedRate,
    mode,
    moneyIn: round2(input.moneyIn),
    moneyOut: round2(input.moneyOut),
    side,
  };
}

export function summarizeTransactions(
  rows: TxCalcInput[],
  catalog: TaxCodeInfo[],
) {
  let moneyIn = 0;
  let moneyOut = 0;
  let salesTaxAmount = 0;
  let provinceTaxAmount = 0;
  let taxAmount = 0;
  let netAmount = 0;

  for (const row of rows) {
    const calc = calculateTransactionAmounts(row, catalog);
    moneyIn += calc.moneyIn;
    moneyOut += calc.moneyOut;
    salesTaxAmount += calc.salesTaxAmount;
    provinceTaxAmount += calc.provinceTaxAmount;
    taxAmount += calc.taxAmount;
    netAmount += calc.netAmount;
  }

  return {
    count: rows.length,
    moneyIn: round2(moneyIn),
    moneyOut: round2(moneyOut),
    salesTaxAmount: round2(salesTaxAmount),
    provinceTaxAmount: round2(provinceTaxAmount),
    taxAmount: round2(taxAmount),
    netAmount: round2(netAmount),
  };
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
