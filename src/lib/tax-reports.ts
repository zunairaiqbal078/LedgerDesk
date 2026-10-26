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

/** Keep GST/HST/NONE/OTHER in taxCodes and PST/QST/RST in provinceTaxCodes. */
export function normalizeTaxCodeAssignment(
  taxCodes: string[],
  provinceTaxCodes: string[],
  catalog: Array<{ code: string; kind: string }>,
): { taxCodes: string[]; provinceTaxCodes: string[] } {
  const kindByCode = new Map(catalog.map((t) => [t.code, t.kind]));
  const sales: string[] = [];
  const pst: string[] = [];
  const seen = new Set<string>();
  for (const code of [...taxCodes, ...provinceTaxCodes]) {
    const trimmed = String(code ?? "").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    if (kindByCode.get(trimmed) === "PST") pst.push(trimmed);
    else sales.push(trimmed);
  }
  return { taxCodes: sales, provinceTaxCodes: pst };
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

function isSettlement(description: string, kind: "GST" | "PST") {
  const d = description.toUpperCase();
  if (kind === "GST") {
    return /CRA|GST\s*PAY|GST\s*REM|HST\s*PAY|HST\s*REM|RECEIVER GENERAL/.test(d);
  }
  return /PST\s*PAY|QST\s*PAY|RST\s*PAY|MINISTER OF FINANCE/.test(d);
}

export type GstLine = {
  id: string;
  date: string;
  description: string;
  role: "sale" | "itc" | "excluded" | "review";
  net: number;
  tax: number;
};

export type GstSummaryResult = {
  taxableSales: number;
  nonTaxableSales: number;
  gstCollected: number;
  itcPaid: number;
  gstPayable: number;
  lines: GstLine[];
};

type GstBucket = {
  taxableSales: number;
  nonTaxableSales: number;
  gstCollected: number;
  itcPaid: number;
  lines: GstLine[];
};

function emptyGstBucket(): GstBucket {
  return {
    taxableSales: 0,
    nonTaxableSales: 0,
    gstCollected: 0,
    itcPaid: 0,
    lines: [],
  };
}

function finalizeGst(b: GstBucket): GstSummaryResult {
  return {
    taxableSales: round2(b.taxableSales),
    nonTaxableSales: round2(b.nonTaxableSales),
    gstCollected: round2(b.gstCollected),
    itcPaid: round2(b.itcPaid),
    gstPayable: round2(b.gstCollected - b.itcPaid),
    lines: b.lines,
  };
}

/** One pass over transactions for many periods (card grid + selected detail). */
export function calculateGstSummariesForPeriods(
  transactions: TxForTax[],
  taxCodes: TaxCodeInfo[],
  periods: Period[],
  selectedKey?: string | null,
): Map<string, GstSummaryResult> {
  const codeMap = new Map(taxCodes.map((t) => [t.code, t]));
  const buckets = new Map<string, GstBucket>();
  for (const p of periods) buckets.set(p.key, emptyGstBucket());
  if (!periods.length) return new Map();

  const periodList = periods.map((p) => ({
    key: p.key,
    start: p.start.getTime(),
    end: p.end.getTime(),
  }));

  for (const tx of transactions) {
    const t = tx.date.getTime();
    const matched = periodList.filter((p) => t >= p.start && t <= p.end);
    if (!matched.length) continue;

    const dateStr = tx.date.toISOString().slice(0, 10);
    let role: GstLine["role"] = "review";
    let net = 0;
    let taxAmt = 0;
    let deltaTaxable = 0;
    let deltaNonTax = 0;
    let deltaCollected = 0;
    let deltaItc = 0;

    if (tx.transferMatchId || isSettlement(tx.description, "GST")) {
      role = "excluded";
    } else {
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
        net = (netIn || inAmt || netOut || outAmt) * sign;
        taxAmt = tax * sign;
        if (hasGst) {
          role = "sale";
          deltaTaxable = net;
          deltaCollected = taxAmt;
        } else {
          role = "review";
          deltaNonTax = net;
          taxAmt = 0;
        }
      } else if (accountType === "ASSET" && inAmt > 0) {
        net = netIn || inAmt;
        if (hasGst) {
          role = "sale";
          taxAmt = tax;
          deltaTaxable = net;
          deltaCollected = tax;
        } else {
          role = "review";
          taxAmt = 0;
          deltaNonTax = net;
        }
      } else if (
        (accountType === "EXPENSE" || accountType === "ASSET") &&
        (outAmt > 0 || inAmt > 0) &&
        hasGst
      ) {
        const sign = outAmt > 0 ? 1 : inAmt > 0 ? -1 : 0;
        taxAmt = tax * sign;
        net =
          sign > 0 ? netOut || outAmt : sign < 0 ? -(netIn || inAmt) : netOut || netIn || 0;
        role = "itc";
        deltaItc = taxAmt;
      } else {
        role = "review";
        net = inAmt || outAmt;
        taxAmt = 0;
      }
    }

    const line: GstLine = {
      id: tx.id,
      date: dateStr,
      description: tx.description,
      role,
      net,
      tax: taxAmt,
    };

    for (const m of matched) {
      const b = buckets.get(m.key)!;
      b.taxableSales += deltaTaxable;
      b.nonTaxableSales += deltaNonTax;
      b.gstCollected += deltaCollected;
      b.itcPaid += deltaItc;
      if (selectedKey && m.key === selectedKey) b.lines.push(line);
    }
  }

  const out = new Map<string, GstSummaryResult>();
  for (const [key, b] of buckets) out.set(key, finalizeGst(b));
  return out;
}

export function calculateGstSummary(
  transactions: TxForTax[],
  taxCodes: TaxCodeInfo[],
  period: Period,
) {
  return (
    calculateGstSummariesForPeriods(transactions, taxCodes, [period], period.key).get(
      period.key,
    ) ?? finalizeGst(emptyGstBucket())
  );
}

export type PstLine = {
  id: string;
  date: string;
  description: string;
  role: "sale" | "paid" | "excluded" | "review";
  net: number;
  tax: number;
};

export type PstSummaryResult = {
  taxableSales: number;
  nonTaxableSales: number;
  pstCollected: number;
  pstPaid: number;
  pstPayable: number;
  lines: PstLine[];
};

type PstBucket = {
  taxableSales: number;
  nonTaxableSales: number;
  pstCollected: number;
  pstPaid: number;
  lines: PstLine[];
};

function emptyPstBucket(): PstBucket {
  return {
    taxableSales: 0,
    nonTaxableSales: 0,
    pstCollected: 0,
    pstPaid: 0,
    lines: [],
  };
}

function finalizePst(b: PstBucket): PstSummaryResult {
  return {
    taxableSales: round2(b.taxableSales),
    nonTaxableSales: round2(b.nonTaxableSales),
    pstCollected: round2(b.pstCollected),
    pstPaid: round2(b.pstPaid),
    pstPayable: round2(b.pstCollected),
    lines: b.lines,
  };
}

/** One pass over transactions for many PST periods. */
export function calculatePstSummariesForPeriods(
  transactions: TxForTax[],
  taxCodes: TaxCodeInfo[],
  periods: Period[],
  clientProvince?: string | null,
  selectedKey?: string | null,
): Map<string, PstSummaryResult> {
  const codeMap = new Map(taxCodes.map((t) => [t.code, t]));
  const buckets = new Map<string, PstBucket>();
  for (const p of periods) buckets.set(p.key, emptyPstBucket());
  if (!periods.length) return new Map();

  const periodList = periods.map((p) => ({
    key: p.key,
    start: p.start.getTime(),
    end: p.end.getTime(),
  }));

  for (const tx of transactions) {
    const t = tx.date.getTime();
    const matched = periodList.filter((p) => t >= p.start && t <= p.end);
    if (!matched.length) continue;

    const dateStr = tx.date.toISOString().slice(0, 10);
    let role: PstLine["role"] = "review";
    let net = 0;
    let taxAmt = 0;
    let deltaTaxable = 0;
    let deltaNonTax = 0;
    let deltaCollected = 0;
    let deltaPaid = 0;

    if (tx.transferMatchId || isSettlement(tx.description, "PST")) {
      role = "excluded";
    } else {
      const selected = allTaxCodesForTx(tx)
        .map((c) => codeMap.get(c))
        .filter(Boolean) as TaxCodeInfo[];
      const pstSelected = selected.filter((c) => c.kind === "PST");
      const hasPst = pstRate(pstSelected) > 0;
      if (clientProvince && tx.province && tx.province !== clientProvince && hasPst) {
        role = "excluded";
      } else {
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
            role = "sale";
            net = netIn || tx.moneyIn;
            taxAmt = tax;
            deltaTaxable = net;
            deltaCollected = tax;
          } else {
            role = "review";
            net = tx.moneyIn;
            taxAmt = 0;
            deltaNonTax = tx.moneyIn;
          }
        } else if (hasPst && tx.moneyOut > 0) {
          role = "paid";
          net = netOut || tx.moneyOut;
          taxAmt = tax;
          deltaPaid = tax;
        } else {
          role = "review";
          net = tx.moneyIn || tx.moneyOut;
          taxAmt = 0;
        }
      }
    }

    const line: PstLine = {
      id: tx.id,
      date: dateStr,
      description: tx.description,
      role,
      net,
      tax: taxAmt,
    };

    for (const m of matched) {
      const b = buckets.get(m.key)!;
      b.taxableSales += deltaTaxable;
      b.nonTaxableSales += deltaNonTax;
      b.pstCollected += deltaCollected;
      b.pstPaid += deltaPaid;
      if (selectedKey && m.key === selectedKey) b.lines.push(line);
    }
  }

  const out = new Map<string, PstSummaryResult>();
  for (const [key, b] of buckets) out.set(key, finalizePst(b));
  return out;
}

export function calculatePstSummary(
  transactions: TxForTax[],
  taxCodes: TaxCodeInfo[],
  period: Period,
  clientProvince?: string | null,
) {
  return (
    calculatePstSummariesForPeriods(
      transactions,
      taxCodes,
      [period],
      clientProvince,
      period.key,
    ).get(period.key) ?? finalizePst(emptyPstBucket())
  );
}

/** Date bounds covering all periods (for DB query scoping). */
export function periodDateBounds(periods: Period[]): { gte: Date; lte: Date } | null {
  if (!periods.length) return null;
  let gte = periods[0]!.start.getTime();
  let lte = periods[0]!.end.getTime();
  for (const p of periods) {
    gte = Math.min(gte, p.start.getTime());
    lte = Math.max(lte, p.end.getTime());
  }
  return { gte: new Date(gte), lte: new Date(lte) };
}
