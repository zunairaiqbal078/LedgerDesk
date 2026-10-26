import { Suspense } from "react";
import { PstReportActions } from "@/components/tax/tax-report-actions";
import { TaxFilterForm } from "@/components/tax/tax-filter-form";
import { TaxRangeSummary } from "@/components/tax/tax-range-summary";
import { TaxTransactionBrowser } from "@/components/tax/tax-transaction-browser";
import { prisma } from "@/lib/db";
import { requireOrgContext } from "@/lib/session";
import { provinceTaxProfileText } from "@/lib/province-tax-profile";
import {
  calculatePstSummary,
  normalizeTaxCodeAssignment,
  type Period,
} from "@/lib/tax-reports";
import type { TaxPdfLine } from "@/lib/tax-report-pdf";

function parseUtcDate(value: string | undefined, endOfDay = false): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  if (endOfDay) return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
  return new Date(Date.UTC(y, m - 1, d));
}

function defaultRange() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const end = now.toISOString().slice(0, 10);
  return { start: `${y}-01-01`, end };
}

export default async function PstPane({
  searchParams,
}: {
  searchParams: Promise<{
    customStart?: string;
    customEnd?: string;
  }>;
}) {
  const params = await searchParams;
  const { organization } = await requireOrgContext("VIEWER");

  const defaults = defaultRange();
  const startStr = params.customStart || defaults.start;
  const endStr = params.customEnd || defaults.end;
  const customStart = parseUtcDate(startStr);
  const customEnd = parseUtcDate(endStr, true);

  const rangeValid = !!(customStart && customEnd && customEnd >= customStart);
  const period: Period | null = rangeValid
    ? {
        key: "custom-range",
        label: `${startStr} → ${endStr}`,
        start: customStart!,
        end: customEnd!,
      }
    : null;

  const [taxCodes, chart] = await Promise.all([
    prisma.taxCode.findMany({ where: { organizationId: organization.id } }),
    prisma.chartAccount.findMany({
      where: { organizationId: organization.id },
      select: { number: true, name: true, type: true },
    }),
  ]);

  const transactions = period
    ? await prisma.transaction.findMany({
        where: {
          organizationId: organization.id,
          date: { gte: period.start, lte: period.end },
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
      })
    : [];

  const typeByNumber = new Map(chart.map((a) => [a.number, a.type]));
  const typeByName = new Map(chart.map((a) => [a.name, a.type]));

  const catalog = taxCodes.map((t) => ({
    code: t.code,
    rate: Number(t.rate),
    kind: t.kind as "GST_HST" | "PST" | "OTHER" | "NONE",
  }));

  const txNormalized = transactions.map((tx) => {
    const normalized = normalizeTaxCodeAssignment(tx.taxCodes, tx.provinceTaxCodes ?? [], catalog);
    return {
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
      taxCodes: normalized.taxCodes,
      provinceTaxCodes: normalized.provinceTaxCodes,
      taxMode: tx.taxMode as "INCLUSIVE" | "EXCLUSIVE" | "KEEP",
      transferMatchId: tx.transferMatchId,
      province: tx.province,
    };
  });

  const summary = period
    ? calculatePstSummary(txNormalized, catalog, period, organization.defaultProvince)
    : null;

  const pdfLines: TaxPdfLine[] = (summary?.lines ?? []).map((line) => {
    const tx = txNormalized.find((t) => t.id === line.id);
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

  return (
    <div className="space-y-4">
      <div className="toolbar">
        {summary && period ? (
          <PstReportActions
            clientName={organization.name}
            frequencyLabel="Custom"
            periodLabel={period.label}
            start={startStr}
            end={endStr}
            totals={{
              taxableSales: summary.taxableSales,
              nonTaxableSales: summary.nonTaxableSales,
              pstCollected: summary.pstCollected,
              pstPaid: summary.pstPaid,
              pstPayable: summary.pstPayable,
            }}
            lines={pdfLines}
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
        · {transactions.length} transaction{transactions.length === 1 ? "" : "s"} in range
      </p>

      <Suspense fallback={null}>
        <TaxFilterForm tab="pst" customStart={startStr} customEnd={endStr} />
      </Suspense>

      {!rangeValid ? (
        <p className="gst-note text-amber-700">
          Choose a valid start and end date (end must be on or after start).
        </p>
      ) : (
        <p className="gst-note">
          PST/QST/RST uses sales-tax codes classified as <strong>PST</strong>. Income feeds taxable
          or non-taxable sales. PST paid on purchases is shown for reference and is{" "}
          <strong>not automatically deducted</strong> from PST payable (provincial ITC rules vary).
        </p>
      )}

      {summary && period ? (
        <>
          <TaxRangeSummary
            kind="pst"
            start={startStr}
            end={endStr}
            metrics={[
              { label: "PST Taxable Sales", value: summary.taxableSales },
              { label: "Non-Taxable Sales", value: summary.nonTaxableSales },
              { label: "PST Collected", value: summary.pstCollected },
              { label: "PST Paid on Purchases", value: summary.pstPaid },
              {
                label: "PST Payable",
                value: summary.pstPayable,
                emphasize:
                  summary.pstPayable < 0
                    ? "negative"
                    : summary.pstPayable > 0
                      ? "positive"
                      : "neutral",
              },
            ]}
          />
          <TaxTransactionBrowser
            kind="pst"
            lines={summary.lines}
            emptyMessage="No PST transactions in this date range. Assign PST/QST/RST codes on categorized rows."
          />
        </>
      ) : null}
    </div>
  );
}
