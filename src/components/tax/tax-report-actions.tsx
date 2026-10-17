"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  downloadGstPeriodPdf,
  downloadGstYearPdf,
  downloadPstPeriodPdf,
  downloadPstYearPdf,
  type PeriodCardTotals,
  type TaxPdfLine,
} from "@/lib/tax-report-pdf";

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
  yearLabel,
  totals,
  lines,
  yearPeriods,
}: {
  clientName: string;
  frequencyLabel: string;
  periodLabel: string;
  start: string;
  end: string;
  yearLabel: string;
  totals: GstTotals;
  lines: TaxPdfLine[];
  yearPeriods: PeriodCardTotals[];
}) {
  const router = useRouter();

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
            downloadGstPeriodPdf({
              clientName,
              frequencyLabel,
              periodLabel,
              start,
              end,
              totals,
              lines,
            });
            toast.success("Period PDF downloaded");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "PDF failed");
          }
        }}
      >
        Download Period PDF
      </button>
      <button
        type="button"
        className="btn-converter btn-light"
        onClick={() => {
          try {
            downloadGstYearPdf({
              clientName,
              frequencyLabel,
              yearLabel,
              periods: yearPeriods,
            });
            toast.success("GST-year PDF downloaded");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "PDF failed");
          }
        }}
      >
        Download GST-Year PDF
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
  yearLabel,
  totals,
  lines,
  yearPeriods,
}: {
  clientName: string;
  frequencyLabel: string;
  periodLabel: string;
  start: string;
  end: string;
  yearLabel: string;
  totals: PstTotals;
  lines: TaxPdfLine[];
  yearPeriods: PeriodCardTotals[];
}) {
  const router = useRouter();

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
            downloadPstPeriodPdf({
              clientName,
              frequencyLabel,
              periodLabel,
              start,
              end,
              totals,
              lines,
            });
            toast.success("Period PDF downloaded");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "PDF failed");
          }
        }}
      >
        Download Period PDF
      </button>
      <button
        type="button"
        className="btn-converter btn-light"
        onClick={() => {
          try {
            downloadPstYearPdf({
              clientName,
              frequencyLabel,
              yearLabel,
              periods: yearPeriods,
            });
            toast.success("Fiscal-year PDF downloaded");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "PDF failed");
          }
        }}
      >
        Download Fiscal-Year PDF
      </button>
    </div>
  );
}
