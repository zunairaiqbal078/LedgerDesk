import { ReconciliationWorkspace } from "@/components/reconciliation-workspace";
import { prisma } from "@/lib/db";
import { canEditTransactions } from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";

export default async function ReconciliationPane() {
  const { organization, activeBank, role } = await requireOrgContext("VIEWER");

  const reconSince = new Date();
  reconSince.setUTCFullYear(reconSince.getUTCFullYear() - 3);

  const [transactions, history, accounts] = await Promise.all([
    activeBank
      ? prisma.transaction.findMany({
          where: {
            organizationId: organization.id,
            bankAccountId: activeBank.id,
            date: { gte: reconSince },
          },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: 1500,
          select: {
            id: true,
            date: true,
            description: true,
            moneyIn: true,
            moneyOut: true,
            accountNumber: true,
            accountName: true,
            reconciledIn: true,
            reconciledOut: true,
          },
        })
      : Promise.resolve([]),
    activeBank
      ? prisma.reconciliation.findMany({
          where: {
            organizationId: organization.id,
            bankAccountId: activeBank.id,
          },
          orderBy: { savedAt: "desc" },
          take: 30,
        })
      : Promise.resolve([]),
    prisma.chartAccount.findMany({
      where: { organizationId: organization.id },
      orderBy: { number: "asc" },
      select: { number: true, name: true },
    }),
  ]);

  const lastFinished = history.find((h) => h.status === "FINISHED");
  const suggestedOpening = lastFinished ? Number(lastFinished.statementEndingBalance) : 0;

  return (
    <ReconciliationWorkspace
      canEdit={canEditTransactions(role)}
      bankName={activeBank?.name ?? null}
      bankType={activeBank?.type ?? null}
      suggestedOpening={suggestedOpening}
      accounts={accounts}
      transactions={transactions.map((tx) => ({
        id: tx.id,
        date: tx.date.toISOString().slice(0, 10),
        description: tx.description,
        moneyIn: Number(tx.moneyIn),
        moneyOut: Number(tx.moneyOut),
        accountNumber: tx.accountNumber,
        accountName: tx.accountName,
        reconciledIn: tx.reconciledIn,
        reconciledOut: tx.reconciledOut,
      }))}
      history={history.map((item) => ({
        id: item.id,
        status: item.status,
        endDate: item.endDate.toISOString().slice(0, 10),
        openingBalance: Number(item.openingBalance),
        statementEndingBalance: Number(item.statementEndingBalance),
        calculatedEndingBalance: Number(item.calculatedEndingBalance),
        difference: Number(item.difference),
        clearedCount: item.clearedInIds.length + item.clearedOutIds.length,
        savedAt: item.savedAt.toISOString().slice(0, 16).replace("T", " "),
      }))}
    />
  );
}
