import { Suspense } from "react";
import { DualScrollArea } from "@/components/dual-scroll-area";
import { Badge } from "@/components/ui";
import { PeriodSummaryGrid } from "@/components/tax/period-summary-grid";
import { PstReportActions } from "@/components/tax/tax-report-actions";
import { TaxFilterForm } from "@/components/tax/tax-filter-form";
import { prisma } from "@/lib/db";
import { requireOrgContext } from "@/lib/session";
import { provinceTaxProfileText } from "@/lib/province-tax-profile";
import {
  buildPeriods,
  calculatePstSummariesForPeriods,
  periodDateBounds,
} from "@/lib/tax-reports";
import { compactPeriodTitle, type PeriodCardTotals, type TaxPdfLine } from "@/lib/tax-report-pdf";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default async function PstPane({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; period?: string; frequency?: string }>;
}) {
  const params = await searchParams;
  const { organization } = await requireOrgContext("VIEWER");

  const year = Number(params.year) || new Date().getUTCFullYear();
  const requested = params.frequency as "MONTHLY" | "QUARTERLY" | "YEARLY" | undefined;
  const frequency: "MONTHLY" | "QUARTERLY" | "YEARLY" =
    requested ??
    (organization.pstFilingFrequency === "CUSTOM"
      ? "QUARTERLY"
      : organization.pstFilingFrequency);

  const periods = buildPeriods(
    frequency,
    organization.fiscalYearStartMonth,
    organization.fiscalYearStartDay,
    year,
  );
  const selected = periods.find((p) => p.key === params.period) ?? periods[0] ?? null;
  const bounds = periodDateBounds(periods);

  const [taxCodes, chart] = await Promise.all([
    prisma.taxCode.findMany({ where: { organizationId: organization.id } }),
    prisma.chartAccount.findMany({
      where: { organizationId: organization.id },
      select: { number: true, name: true, type: true },
    }),
  ]);

  const transactions = await prisma.transaction.findMany({
    where: {
      organizationId: organization.id,
      ...(bounds ? { date: { gte: bounds.gte, lte: bounds.lte } } : {}),
    },
    orderBy: { date: "asc" },
    select: {
      id: true,
      date: true,
      description: true,
      moneyIn: true,
      moneyOut: true,
      accountNumber: true,
      accountName: true,
      taxCodes: true,
      provinceTaxCodes: true,
      taxMode: true,
      transferMatchId: true,
      province: true,
    },
  });

  const typeByNumber = new Map(chart.map((a) => [a.number, a.type]));
  const typeByName = new Map(chart.map((a) => [a.name, a.type]));

  const txForTax = transactions.map((tx) => ({
    id: tx.id,
    date: tx.date,
    description: tx.description,
    moneyIn: Number(tx.moneyIn),
    moneyOut: Number(tx.moneyOut),
    accountNumber: tx.accountNumber,
    accountName: tx.accountName,
    accountType:
      (tx.accountNumber ? typeByNumber.get(tx.accountNumber) : undefined) ??
      (tx.accountName ? typeByName.get(tx.accountName) : undefined) ??
      null,
    taxCodes: tx.taxCodes,
    provinceTaxCodes: tx.provinceTaxCodes,
    taxMode: tx.taxMode as "INCLUSIVE" | "EXCLUSIVE" | "KEEP",
    transferMatchId: tx.transferMatchId,
    province: tx.province,
  }));

  const catalog = taxCodes.map((t) => ({
    code: t.code,
    rate: Number(t.rate),
    kind: t.kind as "GST_HST" | "PST" | "OTHER" | "NONE",
  }));

  const byPeriod = calculatePstSummariesForPeriods(
    txForTax,
    catalog,
    periods,
    organization.defaultProvince,
    selected?.key,
  );

  const periodCards: PeriodCardTotals[] = periods.map((p) => {
    const s = byPeriod.get(p.key)!;
    return {
      key: p.key,
      title: compactPeriodTitle(frequency, p, "pst"),
      label: p.label,
      start: p.start.toISOString().slice(0, 10),
      end: p.end.toISOString().slice(0, 10),
      taxableSales: s.taxableSales,
      nonTaxableSales: s.nonTaxableSales,
      collected: s.pstCollected,
      paidOrItc: s.pstPaid,
      payable: s.pstPayable,
    };
  });

  const summary = selected ? byPeriod.get(selected.key) ?? null : null;

  const pdfLines: TaxPdfLine[] = (summary?.lines ?? []).map((line) => {
    const tx = txForTax.find((t) => t.id === line.id);
    return {
      date: line.date,
      description: line.description,
      account: [tx?.accountNumber, tx?.accountName].filter(Boolean).join(" — ") || "—",
      accountType: tx?.accountType ?? "—",
      net: line.net,
      tax: line.tax,
      role: line.role,
    };
  });

  const monthName =
    MONTHS[Math.min(11, Math.max(0, organization.fiscalYearStartMonth - 1))] ?? "January";
  const yearBasisLabel = `Fiscal year starts ${monthName} ${organization.fiscalYearStartDay}`;
  const frequencyLabel =
    frequency === "MONTHLY" ? "Monthly" : frequency === "QUARTERLY" ? "Quarterly" : "Yearly";

  return (
    <div className="space-y-4">
      <div className="toolbar">
        {summary && selected ? (
          <PstReportActions
            clientName={organization.name}
            frequencyLabel={frequencyLabel}
            periodLabel={selected.label}
            start={selected.start.toISOString().slice(0, 10)}
            end={selected.end.toISOString().slice(0, 10)}
            yearLabel={`Fiscal year ${year} (${yearBasisLabel})`}
            totals={{
              taxableSales: summary.taxableSales,
              nonTaxableSales: summary.nonTaxableSales,
              pstCollected: summary.pstCollected,
              pstPaid: summary.pstPaid,
              pstPayable: summary.pstPayable,
            }}
            lines={pdfLines}
            yearPeriods={periodCards}
          />
        ) : (
          <div className="toolbar-left">
            <button type="button" className="btn-converter btn-green" disabled>
              Refresh PST Calculation
            </button>
          </div>
        )}
      </div>

      <p className="text-sm text-slate-600">
        Client: <strong>{organization.name}</strong>
        {organization.defaultProvince ? (
          <> · {provinceTaxProfileText(organization.defaultProvince)}</>
        ) : (
          " · PST uses province tax codes on each transaction."
        )}{" "}
        · {transactions.length} transaction{transactions.length === 1 ? "" : "s"} in books
      </p>

      <Suspense fallback={null}>
        <TaxFilterForm
          tab="pst"
          year={year}
          frequency={frequency}
          periodKey={selected?.key ?? ""}
          periods={periods.map((p) => ({ key: p.key, label: p.label }))}
          yearBasisLabel={yearBasisLabel}
          frequencyLabel="PST reporting frequency"
        />
      </Suspense>

      <p className="gst-note">
        PST/QST/RST uses sales-tax codes classified as <strong>PST</strong>. Income feeds taxable or
        non-taxable sales. PST paid on purchases is shown for reference and is{" "}
        <strong>not automatically deducted</strong> from PST payable (provincial ITC rules vary).
      </p>

      <Suspense fallback={null}>
        <PeriodSummaryGrid
          kind="pst"
          frequency={frequency}
          periods={periodCards}
          selectedKey={selected?.key ?? ""}
          tab="pst"
        />
      </Suspense>

      {summary ? (
        <DualScrollArea className="table-wrap">
          <table className="tx-table pst-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Role</th>
                <th className="num">Net</th>
                <th className="num">PST</th>
              </tr>
            </thead>
            <tbody>
              {summary.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.date}</td>
                  <td>{line.description}</td>
                  <td>
                    <Badge>{line.role}</Badge>
                  </td>
                  <td className="num">${line.net.toFixed(2)}</td>
                  <td className="num">${line.tax.toFixed(2)}</td>
                </tr>
              ))}
              {!summary.lines.length ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                    No PST transactions for this period. Assign PST/QST/RST codes on categorized
                    rows.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </DualScrollArea>
      ) : null}
    </div>
  );
}
