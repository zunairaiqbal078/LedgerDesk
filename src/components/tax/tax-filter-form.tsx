"use client";

import { useRouter, usePathname } from "next/navigation";

type PeriodOption = { key: string; label: string };

export function TaxFilterForm({
  tab,
  year,
  frequency,
  periodKey,
  periods,
  yearBasisLabel,
  frequencyLabel,
}: {
  tab: "gst" | "pst";
  year: number;
  frequency: "MONTHLY" | "QUARTERLY" | "YEARLY";
  periodKey: string;
  periods: PeriodOption[];
  yearBasisLabel: string;
  frequencyLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function navigate(next: { year?: number; frequency?: string; period?: string | null }) {
    const params = new URLSearchParams();
    params.set("tab", tab);
    params.set("year", String(next.year ?? year));
    params.set("frequency", next.frequency ?? frequency);
    // Empty period = let server pick first period for new year/frequency
    if (next.period != null && next.period !== "") {
      params.set("period", next.period);
    } else if (next.period == null && periodKey) {
      params.set("period", periodKey);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="gst-toolbar rounded-xl border border-[#d6e1e9] bg-slate-50 p-4">
      <div className="field">
        <label>Year</label>
        <input
          type="number"
          value={year}
          onChange={(e) => navigate({ year: Number(e.target.value) || year, period: "" })}
        />
      </div>
      <div className="field">
        <label>{frequencyLabel}</label>
        <select
          value={frequency}
          onChange={(e) =>
            navigate({
              frequency: e.target.value,
              period: "",
            })
          }
        >
          <option value="MONTHLY">Monthly</option>
          <option value="QUARTERLY">Quarterly</option>
          <option value="YEARLY">Yearly</option>
        </select>
      </div>
      <div className="field" style={{ minWidth: 280 }}>
        <label>Reporting period</label>
        <select
          value={periodKey}
          onChange={(e) => navigate({ period: e.target.value })}
        >
          {periods.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ minWidth: 220 }}>
        <label>{tab === "gst" ? "GST year basis" : "Fiscal year basis"}</label>
        <input readOnly value={yearBasisLabel} />
      </div>
    </div>
  );
}
