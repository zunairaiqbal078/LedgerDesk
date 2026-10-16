import { GeneralEntriesWorkspace } from "@/components/general-entries-workspace";
import { prisma } from "@/lib/db";
import { canEditTransactions } from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";

export default async function GeneralEntriesPane() {
  const { organization, role } = await requireOrgContext("VIEWER");

  const [entries, accounts] = await Promise.all([
    prisma.generalEntry.findMany({
      where: { organizationId: organization.id },
      include: { lines: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    prisma.chartAccount.findMany({
      where: { organizationId: organization.id },
      orderBy: { number: "asc" },
    }),
  ]);

  return (
    <GeneralEntriesWorkspace
      canEdit={canEditTransactions(role)}
      accounts={accounts.map((a) => ({ number: a.number, name: a.name }))}
      entries={entries.map((entry) => {
        const debit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
        const credit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
        return {
          id: entry.id,
          date: entry.date.toISOString().slice(0, 10),
          memo: entry.memo,
          periodLabel: entry.periodLabel,
          source: entry.source,
          debit,
          credit,
          lines: entry.lines.map((line) => ({
            id: line.id,
            accountNumber: line.accountNumber,
            accountName: line.accountName,
            memo: line.memo,
            debit: Number(line.debit),
            credit: Number(line.credit),
          })),
        };
      })}
    />
  );
}
