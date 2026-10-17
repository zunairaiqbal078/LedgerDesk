/**
 * Client-side GST/PST PDF export (jsPDF) — mirrors ledgerdesk_statement_converter HTML.
 */
import { jsPDF } from "jspdf";

export type TaxPdfLine = {
  date: string;
  description: string;
  account: string;
  accountType: string;
  net: number;
  tax: number;
  role: string;
};

export type PeriodCardTotals = {
  key: string;
  title: string;
  label: string;
  start: string;
  end: string;
  taxableSales: number;
  nonTaxableSales: number;
  collected: number;
  paidOrItc: number;
  payable: number;
};

function money(n: number) {
  return `$${Number(n).toFixed(2)}`;
}

function safeFilePart(s: string) {
  return s.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").slice(0, 48);
}

function drawHeader(
  doc: jsPDF,
  opts: {
    title: string;
    clientName: string;
    basis: string;
    periodLabel: string;
    range: string;
  },
  y: number,
) {
  const margin = 32;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(opts.title, margin, y);
  y += 18;
  doc.setFontSize(10);
  doc.text(`Client: ${opts.clientName}`, margin, y);
  doc.text(`Reporting basis: ${opts.basis}`, 360, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.text(`Period: ${opts.periodLabel}`, margin, y);
  doc.text(opts.range, 360, y);
  return y + 16;
}

function drawSummaryBand(
  doc: jsPDF,
  y: number,
  items: Array<[string, number]>,
) {
  const margin = 32;
  const pageW = doc.internal.pageSize.getWidth();
  const usable = pageW - margin * 2;
  const colW = usable / items.length;
  doc.setFillColor(238, 244, 248);
  doc.rect(margin, y - 10, usable, 36, "F");
  items.forEach(([label, value], i) => {
    const x = margin + i * colW + 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(60, 80, 95);
    doc.text(label, x, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(20, 40, 55);
    doc.text(money(value), x, y + 14);
  });
  doc.setTextColor(0, 0, 0);
  return y + 40;
}

function drawTableHeader(doc: jsPDF, y: number, cols: Array<{ label: string; x: number }>) {
  const margin = 32;
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(238, 244, 248);
  doc.rect(margin, y - 10, pageW - margin * 2, 16, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  cols.forEach((c) => doc.text(c.label, c.x, y));
  return y + 12;
}

function ensurePage(doc: jsPDF, y: number, need: number, redrawHeader: () => number) {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + need > pageH - 28) {
    doc.addPage();
    return redrawHeader();
  }
  return y;
}

export function downloadGstPeriodPdf(opts: {
  clientName: string;
  frequencyLabel: string;
  periodLabel: string;
  start: string;
  end: string;
  totals: {
    taxableSales: number;
    nonTaxableSales: number;
    gstCollected: number;
    itcPaid: number;
    gstPayable: number;
  };
  lines: TaxPdfLine[];
}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const margin = 32;
  const cols = [
    { label: "Date", x: margin },
    { label: "Description", x: margin + 70 },
    { label: "Account", x: margin + 280 },
    { label: "Type", x: margin + 400 },
    { label: "Net Amount", x: margin + 460 },
    { label: "GST/HST", x: margin + 540 },
    { label: "Treatment", x: margin + 610 },
  ];

  const paintTop = () => {
    let y = drawHeader(
      doc,
      {
        title: "GST Filing Calculation",
        clientName: opts.clientName,
        basis: opts.frequencyLabel,
        periodLabel: opts.periodLabel,
        range: `${opts.start} to ${opts.end}`,
      },
      36,
    );
    y = drawSummaryBand(doc, y, [
      ["Taxable Sales", opts.totals.taxableSales],
      ["Non-Taxable Sales", opts.totals.nonTaxableSales],
      ["GST Collected", opts.totals.gstCollected],
      ["ITCs Paid", opts.totals.itcPaid],
      ["GST Payable", opts.totals.gstPayable],
    ]);
    return drawTableHeader(doc, y, cols);
  };

  let y = paintTop();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  for (const line of opts.lines) {
    y = ensurePage(doc, y, 12, paintTop);
    const desc =
      line.description.length > 42 ? `${line.description.slice(0, 40)}…` : line.description;
    const acct = line.account.length > 22 ? `${line.account.slice(0, 20)}…` : line.account;
    doc.text(line.date, cols[0]!.x, y);
    doc.text(desc, cols[1]!.x, y);
    doc.text(acct, cols[2]!.x, y);
    doc.text(line.accountType || "—", cols[3]!.x, y);
    doc.text(money(line.net), cols[4]!.x, y);
    doc.text(money(line.tax), cols[5]!.x, y);
    doc.text(line.role, cols[6]!.x, y);
    y += 11;
  }

  doc.save(
    `${safeFilePart(opts.clientName)}_${safeFilePart(opts.periodLabel)}_${opts.start}_to_${opts.end}_GST.pdf`,
  );
}

export function downloadGstYearPdf(opts: {
  clientName: string;
  frequencyLabel: string;
  yearLabel: string;
  periods: PeriodCardTotals[];
}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const margin = 32;
  let y = 36;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`${opts.frequencyLabel} GST Filing Calculation`, margin, y);
  y += 18;
  doc.setFontSize(10);
  doc.text(`Client: ${opts.clientName}`, margin, y);
  doc.text(opts.yearLabel, 360, y);
  y += 20;

  const cols = [
    { label: "Period", x: margin },
    { label: "Range", x: margin + 90 },
    { label: "Taxable", x: margin + 260 },
    { label: "Non-Tax", x: margin + 340 },
    { label: "Collected", x: margin + 420 },
    { label: "ITCs", x: margin + 510 },
    { label: "Payable", x: margin + 580 },
  ];
  y = drawTableHeader(doc, y, cols);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  const totals = {
    taxableSales: 0,
    nonTaxableSales: 0,
    collected: 0,
    paidOrItc: 0,
    payable: 0,
  };

  for (const p of opts.periods) {
    y = ensurePage(doc, y, 12, () => drawTableHeader(doc, 36, cols));
    doc.text(p.title, cols[0]!.x, y);
    doc.text(`${p.start} → ${p.end}`, cols[1]!.x, y);
    doc.text(money(p.taxableSales), cols[2]!.x, y);
    doc.text(money(p.nonTaxableSales), cols[3]!.x, y);
    doc.text(money(p.collected), cols[4]!.x, y);
    doc.text(money(p.paidOrItc), cols[5]!.x, y);
    doc.text(money(p.payable), cols[6]!.x, y);
    totals.taxableSales += p.taxableSales;
    totals.nonTaxableSales += p.nonTaxableSales;
    totals.collected += p.collected;
    totals.paidOrItc += p.paidOrItc;
    totals.payable += p.payable;
    y += 11;
  }

  y += 4;
  doc.setFont("helvetica", "bold");
  doc.text("GST-Year Total", cols[0]!.x, y);
  doc.text(money(totals.taxableSales), cols[2]!.x, y);
  doc.text(money(totals.nonTaxableSales), cols[3]!.x, y);
  doc.text(money(totals.collected), cols[4]!.x, y);
  doc.text(money(totals.paidOrItc), cols[5]!.x, y);
  doc.text(money(totals.payable), cols[6]!.x, y);

  doc.save(`${safeFilePart(opts.clientName)}_${safeFilePart(opts.yearLabel)}_GST_Year.pdf`);
}

export function downloadPstPeriodPdf(opts: {
  clientName: string;
  frequencyLabel: string;
  periodLabel: string;
  start: string;
  end: string;
  totals: {
    taxableSales: number;
    nonTaxableSales: number;
    pstCollected: number;
    pstPaid: number;
    pstPayable: number;
  };
  lines: TaxPdfLine[];
}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const margin = 32;
  const cols = [
    { label: "Date", x: margin },
    { label: "Description", x: margin + 70 },
    { label: "Account", x: margin + 280 },
    { label: "Type", x: margin + 400 },
    { label: "Net Amount", x: margin + 460 },
    { label: "PST", x: margin + 540 },
    { label: "Treatment", x: margin + 610 },
  ];

  const paintTop = () => {
    let y = drawHeader(
      doc,
      {
        title: "PST Filing Calculation",
        clientName: opts.clientName,
        basis: opts.frequencyLabel,
        periodLabel: opts.periodLabel,
        range: `${opts.start} to ${opts.end}`,
      },
      36,
    );
    y = drawSummaryBand(doc, y, [
      ["PST Taxable Sales", opts.totals.taxableSales],
      ["Non-Taxable Sales", opts.totals.nonTaxableSales],
      ["PST Collected", opts.totals.pstCollected],
      ["PST Paid (ref)", opts.totals.pstPaid],
      ["PST Payable", opts.totals.pstPayable],
    ]);
    return drawTableHeader(doc, y, cols);
  };

  let y = paintTop();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  for (const line of opts.lines) {
    y = ensurePage(doc, y, 12, paintTop);
    const desc =
      line.description.length > 42 ? `${line.description.slice(0, 40)}…` : line.description;
    const acct = line.account.length > 22 ? `${line.account.slice(0, 20)}…` : line.account;
    doc.text(line.date, cols[0]!.x, y);
    doc.text(desc, cols[1]!.x, y);
    doc.text(acct, cols[2]!.x, y);
    doc.text(line.accountType || "—", cols[3]!.x, y);
    doc.text(money(line.net), cols[4]!.x, y);
    doc.text(money(line.tax), cols[5]!.x, y);
    doc.text(line.role, cols[6]!.x, y);
    y += 11;
  }

  doc.save(
    `${safeFilePart(opts.clientName)}_${safeFilePart(opts.periodLabel)}_${opts.start}_to_${opts.end}_PST.pdf`,
  );
}

export function downloadPstYearPdf(opts: {
  clientName: string;
  frequencyLabel: string;
  yearLabel: string;
  periods: PeriodCardTotals[];
}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const margin = 32;
  let y = 36;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`${opts.frequencyLabel} PST Filing Calculation`, margin, y);
  y += 18;
  doc.setFontSize(10);
  doc.text(`Client: ${opts.clientName}`, margin, y);
  doc.text(opts.yearLabel, 360, y);
  y += 20;

  const cols = [
    { label: "Period", x: margin },
    { label: "Range", x: margin + 90 },
    { label: "Taxable", x: margin + 260 },
    { label: "Non-Tax", x: margin + 340 },
    { label: "Collected", x: margin + 420 },
    { label: "Paid (ref)", x: margin + 510 },
    { label: "Payable", x: margin + 590 },
  ];
  y = drawTableHeader(doc, y, cols);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  const totals = {
    taxableSales: 0,
    nonTaxableSales: 0,
    collected: 0,
    paidOrItc: 0,
    payable: 0,
  };

  for (const p of opts.periods) {
    y = ensurePage(doc, y, 12, () => drawTableHeader(doc, 36, cols));
    doc.text(p.title, cols[0]!.x, y);
    doc.text(`${p.start} → ${p.end}`, cols[1]!.x, y);
    doc.text(money(p.taxableSales), cols[2]!.x, y);
    doc.text(money(p.nonTaxableSales), cols[3]!.x, y);
    doc.text(money(p.collected), cols[4]!.x, y);
    doc.text(money(p.paidOrItc), cols[5]!.x, y);
    doc.text(money(p.payable), cols[6]!.x, y);
    totals.taxableSales += p.taxableSales;
    totals.nonTaxableSales += p.nonTaxableSales;
    totals.collected += p.collected;
    totals.paidOrItc += p.paidOrItc;
    totals.payable += p.payable;
    y += 11;
  }

  y += 4;
  doc.setFont("helvetica", "bold");
  doc.text("Fiscal-Year Total", cols[0]!.x, y);
  doc.text(money(totals.taxableSales), cols[2]!.x, y);
  doc.text(money(totals.nonTaxableSales), cols[3]!.x, y);
  doc.text(money(totals.collected), cols[4]!.x, y);
  doc.text(money(totals.paidOrItc), cols[5]!.x, y);
  doc.text(money(totals.payable), cols[6]!.x, y);

  doc.save(`${safeFilePart(opts.clientName)}_${safeFilePart(opts.yearLabel)}_PST_Year.pdf`);
}

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Compact card title like HTML (Q1 / Mar / Year). */
export function compactPeriodTitle(
  frequency: "MONTHLY" | "QUARTERLY" | "YEARLY",
  period: { key: string; label: string; start: Date },
  kind: "gst" | "pst" = "gst",
) {
  if (frequency === "YEARLY") {
    return kind === "pst" ? "Fiscal Year" : "GST Year";
  }
  if (frequency === "QUARTERLY") {
    const m = period.key.match(/^Q(\d)/);
    return m ? `Q${m[1]}` : period.label;
  }
  const month = period.start.getUTCMonth();
  return MONTH_SHORT[month] ?? period.label;
}
