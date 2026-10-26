"use client";

import { DualScrollArea } from "@/components/dual-scroll-area";
import { Badge } from "@/components/ui";

export type TaxBrowserLine = {
  id: string;
  date: string;
  description: string;
  role: string;
  net: number;
  tax: number;
};

export function TaxTransactionBrowser({
  kind,
  lines,
  emptyMessage,
}: {
  kind: "gst" | "pst";
  periodStart?: string;
  periodEnd?: string;
  lines: TaxBrowserLine[];
  emptyMessage: string;
}) {
  const taxLabel = kind === "gst" ? "GST" : "PST";
  let net = 0;
  let tax = 0;
  for (const line of lines) {
    net += line.net;
    tax += line.tax;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Showing <strong>{lines.length}</strong> {taxLabel} line
        {lines.length === 1 ? "" : "s"}
        {" · "}
        Net ${net.toFixed(2)} · {taxLabel} ${tax.toFixed(2)}
      </p>

      <DualScrollArea className="table-wrap">
        <table className={`tx-table ${kind}-table`}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Role</th>
              <th className="num">Net</th>
              <th className="num">{taxLabel}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
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
            {!lines.length ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                  {emptyMessage}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </DualScrollArea>
    </div>
  );
}
