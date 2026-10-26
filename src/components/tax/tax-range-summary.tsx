type Metric = { label: string; value: number; emphasize?: "positive" | "negative" | "neutral" };

export function TaxRangeSummary({
  kind,
  start,
  end,
  metrics,
}: {
  kind: "gst" | "pst";
  start: string;
  end: string;
  metrics: Metric[];
}) {
  const title = kind === "gst" ? "GST Calculation" : "PST Calculation";

  return (
    <div className="gst-period-summary-wrap">
      <div className="gst-period-summary-grid yearly">
        <div className="gst-period-card selected">
          <div className="gst-period-card-head">
            <div className="gst-period-card-title">{title}</div>
            <div className="gst-period-card-range">
              {start} to {end}
            </div>
          </div>
          <div className="gst-period-metrics">
            {metrics.map((m) => {
              const payableClass =
                m.emphasize === "negative"
                  ? "gst-payable-negative"
                  : m.emphasize === "positive"
                    ? "gst-payable-positive"
                    : "";
              return (
                <div key={m.label} className="gst-period-metric">
                  <span className="k">{m.label}</span>
                  <span className={`v ${payableClass}`}>${m.value.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
