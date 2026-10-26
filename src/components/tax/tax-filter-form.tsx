"use client";

import { useRouter, usePathname } from "next/navigation";

export function TaxFilterForm({
  tab,
  customStart,
  customEnd,
}: {
  tab: "gst" | "pst";
  customStart: string;
  customEnd: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function navigate(next: { customStart?: string; customEnd?: string }) {
    const params = new URLSearchParams();
    params.set("tab", tab);
    const start = next.customStart ?? customStart;
    const end = next.customEnd ?? customEnd;
    if (start) params.set("customStart", start);
    if (end) params.set("customEnd", end);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="gst-toolbar rounded-xl border border-[#d6e1e9] bg-slate-50 p-4">
      <div className="field">
        <label htmlFor={`${tab}-range-start`}>Start date</label>
        <input
          id={`${tab}-range-start`}
          type="date"
          value={customStart}
          onChange={(e) => navigate({ customStart: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={`${tab}-range-end`}>End date</label>
        <input
          id={`${tab}-range-end`}
          type="date"
          value={customEnd}
          onChange={(e) => navigate({ customEnd: e.target.value })}
        />
      </div>
    </div>
  );
}
