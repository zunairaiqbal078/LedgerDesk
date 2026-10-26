"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  downloadGstPeriodPdf,
  downloadPstPeriodPdf,
  type TaxPdfLine,
} from "@/lib/tax-report-pdf";
import { downloadTaxRangeCsv, downloadTaxRangeExcel } from "@/lib/tax-range-export";

type GstTotals = {
  taxableSales: number;
  nonTaxableSales: number;
  gstCollected: number;
  itcPaid: number;
  gstPayable: number;
};

type PstTotals = {
  taxableSales: number;
  nonTaxableSales: number;
  pstCollected: number;
  pstPaid: number;
  pstPayable: number;
};

export function GstReportActions({
  clientName,
  frequencyLabel,
  periodLabel,
  start,
  end,
  totals,
  lines,
}: {
  clientName: string;
  frequencyLabel: string;
  periodLabel: string;
  start: string;
  end: string;
  yearLabel?: string;
  totals: GstTotals;
  lines: TaxPdfLine[];
  yearPeriods?: unknown;
}) {
  const router = useRouter();
  const exportTotals = {
    taxableSales: totals.taxableSales,
    nonTaxableSales: totals.nonTaxableSales,
    collected: totals.gstCollected,
    paidOrItc: totals.itcPaid,
    payable: totals.gstPayable,
  };

  return (
    <div className="toolbar-left flex flex-wrap gap-2">
      <button
        type="button"
        className="btn-converter btn-green"
        onClick={() => {
          router.refresh();
          toast.message("GST calculation refreshed");
        }}
      >
        Refresh GST Calculation
      </button>
      <button
        type="button"
        className="btn-converter btn-light"
        onClick={() => {
          try {
            downloadTaxRangeCsv({
              kind: "gst",
              clientName,
              start,
              end,
              totals: exportTotals,
              lines,
            });
            toast.success("CSV downloaded");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "CSV failed");
          }
        }}
      >
        Download CSV
      </button>
      <button
        type="button"
        className="btn-converter btn-light"
        onClick={async () => {
          try {
            await downloadTaxRangeExcel({
              kind: "gst",
              clientName,
              start,
              end,
              totals: exportTotals,
              lines,
            });
            toast.success("Excel downloaded");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Excel failed");
          }
        }}
      >
        Download Excel
      </button>
      <button
        type="button"
        className="btn-converter btn-light"
        onClick={() => {
          try {
            downloadGstPeriodPdf({
              clientName,
              frequencyLabel,
              periodLabel,
              start,
              end,
              totals,
              lines,
            });
            toast.success("PDF downloaded");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "PDF failed");
          }
        }}
      >
        Download PDF
      </button>
    </div>
  );
}

export function PstReportActions({
  clientName,
  frequencyLabel,
  periodLabel,
  start,
  end,
  totals,
  lines,
}: {
  clientName: string;
  frequencyLabel: string;
  periodLabel: string;
  start: string;
  end: string;
  yearLabel?: string;
  totals: PstTotals;
  lines: TaxPdfLine[];
  yearPeriods?: unknown;
}) {
  const router = useRouter();
  const exportTotals = {
    taxableSales: totals.taxableSales,
    nonTaxableSales: totals.nonTaxableSales,
    collected: totals.pstCollected,
    paidOrItc: totals.pstPaid,
    payable: totals.pstPayable,
  };

  return (
    <div className="toolbar-left flex flex-wrap gap-2">
      <button
        type="button"
        className="btn-converter btn-green"
        onClick={() => {
          router.refresh();
          toast.message("PST calculation refreshed");
        }}
      >
        Refresh PST Calculation
      </button>
      <button
        type="button"
        className="btn-converter btn-light"
        onClick={() => {
          try {
            downloadTaxRangeCsv({
              kind: "pst",
              clientName,
              start,
              end,
              totals: exportTotals,
              lines,
            });
            toast.success("CSV downloaded");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "CSV failed");
          }
        }}
      >
        Download CSV
      </button>
      <button
        type="button"
        className="btn-converter btn-light"
        onClick={async () => {
          try {
            await downloadTaxRangeExcel({
              kind: "pst",
              clientName,
              start,
              end,
              totals: exportTotals,
              lines,
            });
            toast.success("Excel downloaded");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Excel failed");
          }
        }}
      >
        Download Excel
      </button>
      <button
        type="button"
        className="btn-converter btn-light"
        onClick={() => {
          try {
            downloadPstPeriodPdf({
              clientName,
              frequencyLabel,
              periodLabel,
              start,
              end,
              totals,
              lines,
            });
            toast.success("PDF downloaded");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "PDF failed");
          }
        }}
      >
        Download PDF
      </button>
    </div>
  );
}
