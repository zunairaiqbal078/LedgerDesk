export type TaxCodeInfo = {
  code: string;
  rate: number;
  kind: "GST_HST" | "PST" | "OTHER" | "NONE";
};

export type TxForTax = {
  id: string;
  date: Date;
  description: string;
  moneyIn: number;
  moneyOut: number;
  accountNumber: string | null;
  accountName: string | null;
  accountType?: "INCOME" | "EXPENSE" | "ASSET" | "LIABILITY" | "EQUITY" | null;
  taxCodes: string[];
  provinceTaxCodes?: string[];
  taxMode: "INCLUSIVE" | "EXCLUSIVE" | "KEEP";
  transferMatchId?: string | null;
  province?: string | null;
};

function allTaxCodesForTx(tx: TxForTax) {
  return [...tx.taxCodes, ...(tx.provinceTaxCodes ?? [])];
}

function federalRate(codes: TaxCodeInfo[]) {
  return codes.filter((c) => c.kind === "GST_HST").reduce((sum, c) => sum + Number(c.rate), 0);
}

function pstRate(codes: TaxCodeInfo[]) {
  return codes.filter((c) => c.kind === "PST").reduce((sum, c) => sum + Number(c.rate), 0);
}

export type Period = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

function utcDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day));
}

function endOfMonth(year: number, monthIndex: number) {
  return utcDate(year, monthIndex + 1, 0);
}

export function buildPeriodsWithCustom(
  frequency: "MONTHLY" | "QUARTERLY" | "YEARLY",
  yearStartMonth: number,
  yearStartDay: number,
  anchorYear: number,
  customPeriods: Array<{ name: string; startDate: Date; endDate: Date }> = [],
): Period[] {
  const standard = buildPeriods(frequency, yearStartMonth, yearStartDay, anchorYear);
  if (!customPeriods.length) return standard;
  const custom: Period[] = customPeriods.map((p, i) => ({
    key: `custom-${i}-${p.startDate.toISOString().slice(0, 10)}`,
    label: p.name,
    start: p.startDate,
    end: p.endDate,
  }));
  return [...custom, ...standard];
}

export function buildPeriods(
  frequency: "MONTHLY" | "QUARTERLY" | "YEARLY",
  yearStartMonth: number,
  yearStartDay: number,
  anchorYear: number,
): Period[] {
  const startMonth = Math.min(12, Math.max(1, yearStartMonth)) - 1;
  const startDay = Math.min(28, Math.max(1, yearStartDay));
  const yearStart = utcDate(anchorYear, startMonth, startDay);
  const yearEnd = utcDate(anchorYear + 1, startMonth, startDay);
  yearEnd.setUTCDate(yearEnd.getUTCDate() - 1);

  if (frequency === "YEARLY") {
    return [
      {
        key: `Y-${anchorYear}`,
        label: `Year starting ${yearStart.toISOString().slice(0, 10)}`,
        start: yearStart,
        end: yearEnd,
      },
    ];
  }

  if (frequency === "QUARTERLY") {
    return [0, 1, 2, 3].map((q) => {
      const start = utcDate(anchorYear, startMonth + q * 3, startDay);
      const end = utcDate(anchorYear, startMonth + (q + 1) * 3, startDay);
      end.setUTCDate(end.getUTCDate() - 1);
      return {
        key: `Q${q + 1}-${anchorYear}`,
        label: `Q${q + 1} (${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)})`,
        start,
        end,
      };
    });
  }

  return Array.from({ length: 12 }, (_, i) => {
    const start = utcDate(anchorYear, startMonth + i, startDay);
    const end = utcDate(anchorYear, startMonth + i + 1, startDay);
    end.setUTCDate(end.getUTCDate() - 1);
    return {
      key: `M${i + 1}-${anchorYear}`,
      label: `${start.toISOString().slice(0, 7)}`,
      start,
      end: end < start ? endOfMonth(start.getUTCFullYear(), start.getUTCMonth()) : end,
    };
  });
}

/**
 * Matches reference converter (`ledgerdesk_statement_converter`):
 * - Exclusive: kindTax = gross × kindRate/100; net = gross
 * - Inclusive with GST+PST: kindTax = gross × (kindRate/100) / (1 + totalRate/100);
 *   net = gross − total embedded tax (all GST/HST+PST rates)
 */
export function taxAmountFor(
  grossIn: number,
  grossOut: number,
  codes: TaxCodeInfo[],
  mode: "INCLUSIVE" | "EXCLUSIVE" | "KEEP",
  kindFilter: "GST_HST" | "PST",
) {
  const kindRate = codes
    .filter((c) => c.kind === kindFilter)
    .reduce((sum, c) => sum + Number(c.rate), 0);
  const totalRate = codes
    .filter((c) => c.kind === "GST_HST" || c.kind === "PST")
    .reduce((sum, c) => sum + Number(c.rate), 0);

  const gross = grossIn > 0 ? grossIn : grossOut;
  const direction = grossIn > 0 ? "in" : "out";

  if (gross <= 0 || kindRate <= 0) {
    return { tax: 0, netIn: grossIn, netOut: grossOut };
  }

  let tax = 0;
  let net = gross;

  if (mode === "EXCLUSIVE") {
    tax = (gross * kindRate) / 100;
    net = gross;
  } else {
    tax =
      totalRate > 0
        ? (gross * (kindRate / 100)) / (1 + totalRate / 100)
        : 0;
    const totalTax =
      totalRate > 0 ? gross - gross / (1 + totalRate / 100) : 0;
    net = gross - totalTax;
  }

  return {
    tax: round2(tax),
    netIn: direction === "in" ? round2(net) : 0,
    netOut: direction === "out" ? round2(net) : 0,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function inPeriod(date: Date, period: Period) {
  const t = date.getTime();
  return t >= period.start.getTime() && t <= period.end.getTime();
}

function isSettlement(description: string, kind: "GST" | "PST") {
  const d = description.toUpperCase();
  if (kind === "GST") {
    return /CRA|GST\s*PAY|GST\s*REM|HST\s*PAY|HST\s*REM|RECEIVER GENERAL/.test(d);
  }
  return /PST\s*PAY|QST\s*PAY|RST\s*PAY|MINISTER OF FINANCE/.test(d);
}

export function calculateGstSummary(
  transactions: TxForTax[],
  taxCodes: TaxCodeInfo[],
  period: Period,
) {
  const codeMap = new Map(taxCodes.map((t) => [t.code, t]));
  let taxableSales = 0;
  let nonTaxableSales = 0;
  let gstCollected = 0;
  let itcPaid = 0;
  const lines: Array<{
    id: string;
    date: string;
    description: string;
    role: "sale" | "itc" | "excluded" | "review";
    net: number;
    tax: number;
  }> = [];

  for (const tx of transactions) {
    if (!inPeriod(tx.date, period)) continue;
    if (tx.transferMatchId) {
      lines.push({
        id: tx.id,
        date: tx.date.toISOString().slice(0, 10),
        description: tx.description,
        role: "excluded",
        net: 0,
        tax: 0,
      });
      continue;
    }
    if (isSettlement(tx.description, "GST")) {
      lines.push({
        id: tx.id,
        date: tx.date.toISOString().slice(0, 10),
        description: tx.description,
        role: "excluded",
        net: 0,
        tax: 0,
      });
      continue;
    }

    const selected = allTaxCodesForTx(tx)
      .map((c) => codeMap.get(c))
      .filter(Boolean) as TaxCodeInfo[];
    const fedSelected = selected.filter((c) => c.kind === "GST_HST");
    const hasGst = federalRate(fedSelected) > 0;
    const accountType = tx.accountType ?? null;
    const { tax, netIn, netOut } = taxAmountFor(
      tx.moneyIn,
      tx.moneyOut,
      selected,
      tx.taxMode,
      "GST_HST",
    );

    const inAmt = tx.moneyIn;
    const outAmt = tx.moneyOut;

    if (accountType === "INCOME" || (!accountType && inAmt > 0 && !outAmt)) {
      const sign = inAmt > 0 ? 1 : outAmt > 0 ? -1 : 1;
      const net = (netIn || inAmt || netOut || outAmt) * sign;
      const gtax = tax * sign;
      if (hasGst) {
        taxableSales += net;
        gstCollected += gtax;
        lines.push({
          id: tx.id,
          date: tx.date.toISOString().slice(0, 10),
          description: tx.description,
          role: "sale",
          net,
          tax: gtax,
        });
      } else {
        nonTaxableSales += net;
        lines.push({
          id: tx.id,
          date: tx.date.toISOString().slice(0, 10),
          description: tx.description,
          role: "review",
          net,
          tax: 0,
        });
      }
      continue;
    }

    if (accountType === "ASSET" && inAmt > 0) {
      const net = netIn || inAmt;
      if (hasGst) {
        taxableSales += net;
        gstCollected += tax;
        lines.push({
          id: tx.id,
          date: tx.date.toISOString().slice(0, 10),
          description: tx.description,
          role: "sale",
          net,
          tax,
        });
      } else {
        nonTaxableSales += net;
        lines.push({
          id: tx.id,
          date: tx.date.toISOString().slice(0, 10),
          description: tx.description,
          role: "review",
          net,
          tax: 0,
        });
      }
      continue;
    }

    if (
      (accountType === "EXPENSE" || accountType === "ASSET") &&
      (outAmt > 0 || inAmt > 0) &&
      hasGst
    ) {
      const sign = outAmt > 0 ? 1 : inAmt > 0 ? -1 : 0;
      const signedTax = tax * sign;
      const signedNet =
        sign > 0 ? netOut || outAmt : sign < 0 ? -(netIn || inAmt) : netOut || netIn || 0;
      itcPaid += signedTax;
      lines.push({
        id: tx.id,
        date: tx.date.toISOString().slice(0, 10),
        description: tx.description,
        role: "itc",
        net: signedNet,
        tax: signedTax,
      });
      continue;
    }

    lines.push({
      id: tx.id,
      date: tx.date.toISOString().slice(0, 10),
      description: tx.description,
      role: "review",
      net: inAmt || outAmt,
      tax: 0,
    });
  }

  return {
    taxableSales: round2(taxableSales),
    nonTaxableSales: round2(nonTaxableSales),
    gstCollected: round2(gstCollected),
    itcPaid: round2(itcPaid),
    gstPayable: round2(gstCollected - itcPaid),
    lines,
  };
}

export function calculatePstSummary(
  transactions: TxForTax[],
  taxCodes: TaxCodeInfo[],
  period: Period,
  clientProvince?: string | null,
) {
  const codeMap = new Map(taxCodes.map((t) => [t.code, t]));
  let taxableSales = 0;
  let nonTaxableSales = 0;
  let pstCollected = 0;
  let pstPaid = 0;
  const lines: Array<{
    id: string;
    date: string;
    description: string;
    role: "sale" | "paid" | "excluded" | "review";
    net: number;
    tax: number;
  }> = [];

  for (const tx of transactions) {
    if (!inPeriod(tx.date, period)) continue;
    if (tx.transferMatchId || isSettlement(tx.description, "PST")) {
      lines.push({
        id: tx.id,
        date: tx.date.toISOString().slice(0, 10),
        description: tx.description,
        role: "excluded",
        net: 0,
        tax: 0,
      });
      continue;
    }

    const selected = allTaxCodesForTx(tx)
      .map((c) => codeMap.get(c))
      .filter(Boolean) as TaxCodeInfo[];
    const pstSelected = selected.filter((c) => c.kind === "PST");
    const hasPst = pstRate(pstSelected) > 0;
    if (clientProvince && tx.province && tx.province !== clientProvince && hasPst) {
      lines.push({
        id: tx.id,
        date: tx.date.toISOString().slice(0, 10),
        description: tx.description,
        role: "excluded",
        net: 0,
        tax: 0,
      });
      continue;
    }
    const accountType = tx.accountType ?? null;
    const { tax, netIn, netOut } = taxAmountFor(
      tx.moneyIn,
      tx.moneyOut,
      selected,
      tx.taxMode,
      "PST",
    );

    if (accountType === "INCOME" || (!accountType && tx.moneyIn > 0)) {
      if (hasPst) {
        taxableSales += netIn || tx.moneyIn;
        pstCollected += tax;
        lines.push({
          id: tx.id,
          date: tx.date.toISOString().slice(0, 10),
          description: tx.description,
          role: "sale",
          net: netIn || tx.moneyIn,
          tax,
        });
      } else {
        nonTaxableSales += tx.moneyIn;
        lines.push({
          id: tx.id,
          date: tx.date.toISOString().slice(0, 10),
          description: tx.description,
          role: "review",
          net: tx.moneyIn,
          tax: 0,
        });
      }
      continue;
    }

    if (hasPst && tx.moneyOut > 0) {
      pstPaid += tax;
      lines.push({
        id: tx.id,
        date: tx.date.toISOString().slice(0, 10),
        description: tx.description,
        role: "paid",
        net: netOut || tx.moneyOut,
        tax,
      });
      continue;
    }

    lines.push({
      id: tx.id,
      date: tx.date.toISOString().slice(0, 10),
      description: tx.description,
      role: "review",
      net: tx.moneyIn || tx.moneyOut,
      tax: 0,
    });
  }

  return {
    taxableSales: round2(taxableSales),
    nonTaxableSales: round2(nonTaxableSales),
    pstCollected: round2(pstCollected),
    pstPaid: round2(pstPaid),
    // Provincial ITC treatment varies — payable tracks collected only
    pstPayable: round2(pstCollected),
    lines,
  };
}
