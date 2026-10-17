import { TransactionsWorkspace } from "@/components/transactions-workspace";
import { prisma } from "@/lib/db";
import { canEditTransactions } from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";

export default async function TransactionsPane({
  loadedConversionId,
}: {
  loadedConversionId?: string;
}) {
  const { organization, activeBank, banks, role } = await requireOrgContext("VIEWER");

  const loadedFromUrl = loadedConversionId
    ? await prisma.savedConversion.findFirst({
        where: {
          id: loadedConversionId,
          folder: { organizationId: organization.id },
        },
        include: { folder: true },
      })
    : null;

  const [transactions, accounts, taxCodes, folders] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        organizationId: organization.id,
        ...(activeBank ? { bankAccountId: activeBank.id } : {}),
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 500,
      select: {
        id: true,
        bankAccountId: true,
        date: true,
        description: true,
        moneyIn: true,
        moneyOut: true,
        accountNumber: true,
        accountName: true,
        province: true,
        taxCodes: true,
        provinceTaxCodes: true,
        taxMode: true,
        notes: true,
        bankAccount: { select: { name: true, type: true } },
      },
    }),
    prisma.chartAccount.findMany({
      where: { organizationId: organization.id },
      orderBy: { number: "asc" },
      select: { number: true, name: true },
    }),
    prisma.taxCode.findMany({
      where: { organizationId: organization.id },
      orderBy: { code: "asc" },
      select: { code: true, name: true, rate: true, kind: true, province: true },
    }),
    prisma.folder.findMany({
      where: { organizationId: organization.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const taxCatalog = taxCodes.map((t) => ({
    code: t.code,
    rate: Number(t.rate),
    kind: t.kind,
  }));

  return (
    <TransactionsWorkspace
      organizationId={organization.id}
      initialLoadedConversion={
        loadedFromUrl
          ? {
              organizationId: organization.id,
              conversionId: loadedFromUrl.id,
              conversionName: loadedFromUrl.name,
              folderId: loadedFromUrl.folderId,
              folderName: loadedFromUrl.folder.name,
            }
          : null
      }
      canEdit={canEditTransactions(role)}
      bankName={activeBank?.name ?? null}
      activeBankId={activeBank?.id ?? null}
      folders={folders.map((f) => ({ id: f.id, name: f.name }))}
      banks={banks.map((b) => ({
        id: b.id,
        name: b.name,
        type: b.type,
      }))}
      accounts={accounts.map((a) => ({ number: a.number, name: a.name }))}
      taxCodes={taxCodes.map((t) => ({
        code: t.code,
        name: t.name,
        rate: Number(t.rate),
        kind: t.kind,
        province: t.province,
      }))}
      taxCatalog={taxCatalog}
      transactions={transactions.map((tx) => ({
        id: tx.id,
        bankAccountId: tx.bankAccountId,
        date: tx.date.toISOString().slice(0, 10),
        description: tx.description,
        moneyIn: Number(tx.moneyIn),
        moneyOut: Number(tx.moneyOut),
        accountNumber: tx.accountNumber,
        accountName: tx.accountName,
        province: tx.province,
        taxCodes: tx.taxCodes,
        provinceTaxCodes: tx.provinceTaxCodes,
        taxMode: tx.taxMode,
        notes: tx.notes,
        bankName: tx.bankAccount.name,
        bankType: tx.bankAccount.type,
      }))}
    />
  );
}
