"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { PeriodCardTotals } from "@/lib/tax-report-pdf";

type Frequency = "MONTHLY" | "QUARTERLY" | "YEARLY";

const METRIC_LABELS_GST = [
  ["Taxable Sales", "taxableSales"],
  ["Non-Taxable Sales", "nonTaxableSales"],
  ["GST Collected", "collected"],
  ["ITCs Paid", "paidOrItc"],
  ["GST Payable", "payable"],
] as const;

const METRIC_LABELS_PST = [
  ["PST Taxable Sales", "taxableSales"],
  ["Non-Taxable Sales", "nonTaxableSales"],
  ["PST Collected", "collected"],
  ["PST Paid on Purchases", "paidOrItc"],
  ["PST Payable", "payable"],
] as const;

export function PeriodSummaryGrid({
  kind,
  frequency,
  periods,
  selectedKey,
  tab,
}: {
  kind: "gst" | "pst";
  frequency: Frequency;
  periods: PeriodCardTotals[];
  selectedKey: string;
  tab: "gst" | "pst";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const metrics = kind === "gst" ? METRIC_LABELS_GST : METRIC_LABELS_PST;
  const gridClass =
    frequency === "YEARLY" ? "yearly" : frequency === "QUARTERLY" ? "quarterly" : "monthly";

  function selectPeriod(key: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", tab);
    next.set("period", key);
    router.push(`${pathname}?${next.toString()}`);
  }

  if (!periods.length) return null;

  return (
    <div className="gst-period-summary-wrap">
      <div className={`gst-period-summary-grid ${gridClass}`}>
        {periods.map((p) => {
          const payableClass =
            p.payable < 0
              ? "gst-payable-negative"
              : p.payable > 0
                ? "gst-payable-positive"
                : "";
          const selected = p.key === selectedKey;
          return (
            <div key={p.key} className={`gst-period-card${selected ? " selected" : ""}`}>
              <button
                type="button"
                className="gst-period-card-btn"
                onClick={() => selectPeriod(p.key)}
              >
                <div className="gst-period-card-head">
                  <div className="gst-period-card-title">{p.title}</div>
                  <div className="gst-period-card-range">
                    {p.start} to {p.end}
                  </div>
                </div>
                <div className="gst-period-metrics">
                  {metrics.map(([label, field]) => (
                    <div key={label} className="gst-period-metric">
                      <span className="k">{label}</span>
                      <span
                        className={`v ${field === "payable" ? payableClass : ""}`}
                      >
                        ${Number(p[field]).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
