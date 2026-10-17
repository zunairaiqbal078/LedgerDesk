import { Suspense } from "react";
import { DualScrollArea } from "@/components/dual-scroll-area";
import { Badge } from "@/components/ui";
import { PeriodSummaryGrid } from "@/components/tax/period-summary-grid";
import { GstReportActions } from "@/components/tax/tax-report-actions";
import { TaxFilterForm } from "@/components/tax/tax-filter-form";
import { prisma } from "@/lib/db";
import { requireOrgContext } from "@/lib/session";
import { provinceTaxProfileText } from "@/lib/province-tax-profile";
import {
  buildPeriodsWithCustom,
  calculateGstSummariesForPeriods,
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

export default async function GstPane({
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
    (organization.gstFilingFrequency === "CUSTOM"
      ? "QUARTERLY"
      : organization.gstFilingFrequency);

  const [taxCodes, chart, gstPeriods] = await Promise.all([
    prisma.taxCode.findMany({ where: { organizationId: organization.id } }),
    prisma.chartAccount.findMany({
      where: { organizationId: organization.id },
      select: { number: true, name: true, type: true },
    }),
    prisma.gstPeriod.findMany({
      where: { organizationId: organization.id },
      orderBy: { startDate: "asc" },
      select: { name: true, startDate: true, endDate: true },
    }),
  ]);

  const periods = buildPeriodsWithCustom(
    frequency,
    organization.gstYearStartMonth,
    organization.gstYearStartDay,
    year,
    gstPeriods.map((p) => ({ name: p.name, startDate: p.startDate, endDate: p.endDate })),
  );
  const selected = periods.find((p) => p.key === params.period) ?? periods[0] ?? null;
  const bounds = periodDateBounds(periods);

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

  const byPeriod = calculateGstSummariesForPeriods(
    txForTax,
    catalog,
    periods,
    selected?.key,
  );

  const periodCards: PeriodCardTotals[] = periods.map((p) => {
    const s = byPeriod.get(p.key)!;
    return {
      key: p.key,
      title: compactPeriodTitle(frequency, p, "gst"),
      label: p.label,
      start: p.start.toISOString().slice(0, 10),
      end: p.end.toISOString().slice(0, 10),
      taxableSales: s.taxableSales,
      nonTaxableSales: s.nonTaxableSales,
      collected: s.gstCollected,
      paidOrItc: s.itcPaid,
      payable: s.gstPayable,
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

  const monthName = MONTHS[Math.min(11, Math.max(0, organization.gstYearStartMonth - 1))] ?? "January";
  const yearBasisLabel = `GST year starts ${monthName} ${organization.gstYearStartDay}`;
  const frequencyLabel =
    frequency === "MONTHLY" ? "Monthly" : frequency === "QUARTERLY" ? "Quarterly" : "Yearly";

  return (
    <div className="space-y-4">
      <div className="toolbar">
        {summary && selected ? (
          <GstReportActions
            clientName={organization.name}
            frequencyLabel={frequencyLabel}
            periodLabel={selected.label}
            start={selected.start.toISOString().slice(0, 10)}
            end={selected.end.toISOString().slice(0, 10)}
            yearLabel={`GST year ${year} (${yearBasisLabel})`}
            totals={{
              taxableSales: summary.taxableSales,
              nonTaxableSales: summary.nonTaxableSales,
              gstCollected: summary.gstCollected,
              itcPaid: summary.itcPaid,
              gstPayable: summary.gstPayable,
            }}
            lines={pdfLines}
            yearPeriods={periodCards}
          />
        ) : (
          <div className="toolbar-left">
            <button type="button" className="btn-converter btn-green" disabled>
              Refresh GST Calculation
            </button>
          </div>
        )}
      </div>

      <p className="text-sm text-slate-600">
        Client: <strong>{organization.name}</strong>
        {organization.defaultProvince ? (
          <> · {provinceTaxProfileText(organization.defaultProvince)}</>
        ) : (
          " · Set client province in Settings for import/tax defaults."
        )}{" "}
        · {transactions.length} transaction{transactions.length === 1 ? "" : "s"} in books
      </p>

      <Suspense fallback={null}>
        <TaxFilterForm
          tab="gst"
          year={year}
          frequency={frequency}
          periodKey={selected?.key ?? ""}
          periods={periods.map((p) => ({ key: p.key, label: p.label }))}
          yearBasisLabel={yearBasisLabel}
          frequencyLabel="GST reporting frequency"
        />
      </Suspense>

      <p className="gst-note">
        GST reporting periods follow this client&apos;s <strong>GST Year</strong> (not Fiscal Year).
        Taxable / non-taxable sales come from <strong>Income</strong> categories. ITCs come from
        GST/HST-coded <strong>Expense</strong> or <strong>Asset</strong> transactions. CRA remittances
        and matched transfers are excluded.
      </p>

      <Suspense fallback={null}>
        <PeriodSummaryGrid
          kind="gst"
          frequency={frequency}
          periods={periodCards}
          selectedKey={selected?.key ?? ""}
          tab="gst"
        />
      </Suspense>

      {summary ? (
        <DualScrollArea className="table-wrap">
          <table className="tx-table gst-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Role</th>
                <th className="num">Net</th>
                <th className="num">GST</th>
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
                    No GST transactions for this period. Categorize rows and assign GST/HST codes.
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
