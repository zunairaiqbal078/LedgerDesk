import { Suspense } from "react";
import { GstReportActions } from "@/components/tax/tax-report-actions";
import { TaxFilterForm } from "@/components/tax/tax-filter-form";
import { TaxRangeSummary } from "@/components/tax/tax-range-summary";
import { TaxTransactionBrowser } from "@/components/tax/tax-transaction-browser";
import { prisma } from "@/lib/db";
import { requireOrgContext } from "@/lib/session";
import { provinceTaxProfileText } from "@/lib/province-tax-profile";
import { calculateGstSummary, type Period } from "@/lib/tax-reports";
import { loadTransactionsForTaxReports } from "@/lib/tax-transaction-sources";
import type { TaxPdfLine } from "@/lib/tax-report-pdf";
import { TaxClearAllButton } from "@/components/tax/tax-clear-all-button";
import { canEditTransactions } from "@/lib/permissions";

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

export default async function GstPane({
  searchParams,
}: {
  searchParams: Promise<{
    customStart?: string;
    customEnd?: string;
  }>;
}) {
  const params = await searchParams;
  const { organization, role } = await requireOrgContext("VIEWER");
  const canClearBooks = canEditTransactions(role);

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

  const taxCodes = await prisma.taxCode.findMany({
    where: { organizationId: organization.id },
  });
  const catalog = taxCodes.map((t) => ({
    code: t.code,
    rate: Number(t.rate),
    kind: t.kind as "GST_HST" | "PST" | "OTHER" | "NONE",
  }));

  const { transactions: txNormalized, transactionCount } = period
    ? await loadTransactionsForTaxReports(organization.id, {
        start: period.start,
        end: period.end,
      })
    : { transactions: [], transactionCount: 0 };

  const summary = period ? calculateGstSummary(txNormalized, catalog, period) : null;

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
        <div className="toolbar-left flex flex-wrap items-center gap-2">
          {summary && period ? (
            <GstReportActions
              clientName={organization.name}
              frequencyLabel="Custom"
              periodLabel={period.label}
              start={startStr}
              end={endStr}
              totals={{
                taxableSales: summary.taxableSales,
                nonTaxableSales: summary.nonTaxableSales,
                gstCollected: summary.gstCollected,
                itcPaid: summary.itcPaid,
                gstPayable: summary.gstPayable,
              }}
              lines={pdfLines}
            />
          ) : (
            <button type="button" className="btn-converter btn-green" disabled>
              Refresh GST Calculation
            </button>
          )}
          {canClearBooks ? <TaxClearAllButton /> : null}
        </div>
      </div>

      <p className="text-sm text-slate-600">
        Client: <strong>{organization.name}</strong>
        {organization.defaultProvince ? (
          <> · {provinceTaxProfileText(organization.defaultProvince)}</>
        ) : (
          " · Set client province in Settings for import/tax defaults."
        )}{" "}
        · {transactionCount} transaction{transactionCount === 1 ? "" : "s"} in range (saved
        folders + unsaved import)
      </p>

      <Suspense fallback={null}>
        <TaxFilterForm tab="gst" customStart={startStr} customEnd={endStr} />
      </Suspense>

      {!rangeValid ? (
        <p className="gst-note text-amber-700">
          Choose a valid start and end date (end must be on or after start).
        </p>
      ) : (
        <p className="gst-note">
          Includes all <strong>saved folder</strong> snapshots plus any <strong>unsaved</strong> rows
          in Transactions — not only the folder currently loaded. Taxable / non-taxable sales come
          from <strong>Income</strong> categories. ITCs come from GST/HST-coded{" "}
          <strong>Expense</strong> or <strong>Asset</strong> transactions.
        </p>
      )}

      {summary && period ? (
        <>
          <TaxRangeSummary
            kind="gst"
            start={startStr}
            end={endStr}
            metrics={[
              { label: "Taxable Sales", value: summary.taxableSales },
              { label: "Non-Taxable Sales", value: summary.nonTaxableSales },
              { label: "GST Collected", value: summary.gstCollected },
              { label: "ITCs Paid", value: summary.itcPaid },
              {
                label: "GST Payable",
                value: summary.gstPayable,
                emphasize:
                  summary.gstPayable < 0
                    ? "negative"
                    : summary.gstPayable > 0
                      ? "positive"
                      : "neutral",
              },
            ]}
          />
          <TaxTransactionBrowser
            kind="gst"
            lines={summary.lines}
            emptyMessage="No GST transactions in this date range. Categorize rows and assign GST/HST codes."
          />
        </>
      ) : null}
    </div>
  );
}
