import { Badge, Card } from "@/components/ui";
import { prisma } from "@/lib/db";
import { requireOrgContext } from "@/lib/session";
import { provinceTaxProfileText } from "@/lib/province-tax-profile";
import { buildPeriods, calculatePstSummary } from "@/lib/tax-reports";

export default async function PstPane({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; period?: string; frequency?: string }>;
}) {
  const params = await searchParams;
  const { organization } = await requireOrgContext("VIEWER");

  const year = Number(params.year) || new Date().getUTCFullYear();
  const requested = params.frequency as "MONTHLY" | "QUARTERLY" | "YEARLY" | undefined;
  const frequency: "MONTHLY" | "QUARTERLY" | "YEARLY" =
    requested ??
    (organization.pstFilingFrequency === "CUSTOM"
      ? "QUARTERLY"
      : organization.pstFilingFrequency);

  const periods = buildPeriods(
    frequency,
    organization.fiscalYearStartMonth,
    organization.fiscalYearStartDay,
    year,
  );
  const selected = periods.find((p) => p.key === params.period) ?? periods[0] ?? null;

  const [transactions, taxCodes, chart] = await Promise.all([
    prisma.transaction.findMany({
      where: { organizationId: organization.id },
      orderBy: { date: "asc" },
    }),
    prisma.taxCode.findMany({ where: { organizationId: organization.id } }),
    prisma.chartAccount.findMany({ where: { organizationId: organization.id } }),
  ]);

  const typeByNumber = new Map(chart.map((a) => [a.number, a.type]));
  const typeByName = new Map(chart.map((a) => [a.name, a.type]));

  const summary = selected
    ?         calculatePstSummary(
        transactions.map((tx) => ({
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
          taxCodes: tx.taxCodes,
          provinceTaxCodes: tx.provinceTaxCodes,
          taxMode: tx.taxMode,
          transferMatchId: tx.transferMatchId,
          province: tx.province,
        })),
        taxCodes.map((t) => ({
          code: t.code,
          rate: Number(t.rate),
          kind: t.kind,
        })),
        selected,
        organization.defaultProvince,
      )
    : null;

  return (
    <div className="space-y-6">
      <div className="toolbar">
        <div className="toolbar-left">
          <button type="button" className="btn-converter btn-green">
            Refresh PST Calculation
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-600">
        Client: <strong>{organization.name}</strong>
        {organization.defaultProvince ? (
          <> · {provinceTaxProfileText(organization.defaultProvince)}</>
        ) : (
          " · PST uses province tax codes on each transaction."
        )}{" "}
        · {transactions.length} transaction{transactions.length === 1 ? "" : "s"} in books
      </p>

      <Card className="p-4">
        <form action="/app" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="tab" value="pst" />
          <div className="field">
            <label>Year</label>
            <input name="year" type="number" defaultValue={year} />
          </div>
          <div className="field">
            <label>PST reporting frequency</label>
            <select name="frequency" defaultValue={frequency}>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="YEARLY">Yearly</option>
            </select>
          </div>
          <div className="field">
            <label>Reporting period</label>
            <select name="period" defaultValue={selected?.key}>
              {periods.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-converter btn-light">
            Apply
          </button>
        </form>
      </Card>

      {summary ? (
        <>
          <div className="summary">
            {[
              ["PST taxable sales", summary.taxableSales],
              ["Non-taxable sales", summary.nonTaxableSales],
              ["PST collected", summary.pstCollected],
              ["PST paid (ref)", summary.pstPaid],
              ["PST payable", summary.pstPayable],
            ].map(([label, value]) => (
              <div key={String(label)} className="summary-card">
                <div className="k">{label}</div>
                <div className="v">${Number(value).toFixed(2)}</div>
              </div>
            ))}
          </div>

          <div className="table-wrap">
            <table className="tx-table pst-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Role</th>
                  <th className="num">Net</th>
                  <th className="num">PST</th>
                </tr>
              </thead>
              <tbody>
                {summary.lines.map((line) => (
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
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
