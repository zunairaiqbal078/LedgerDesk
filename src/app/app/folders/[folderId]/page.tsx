import Link from "next/link";
import { notFound } from "next/navigation";
import { FolderDetailView } from "@/components/folder-detail-view";
import { prisma } from "@/lib/db";
import { canEditTransactions } from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";

export default async function FolderDetailPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = await params;
  const { organization, role } = await requireOrgContext("VIEWER");

  const folder = await prisma.folder.findFirst({
    where: { id: folderId, organizationId: organization.id },
    include: {
      conversions: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!folder) notFound();

  return (
    <FolderDetailView
      canEdit={canEditTransactions(role)}
      organizationId={organization.id}
      clientName={organization.name}
      folder={{
        id: folder.id,
        name: folder.name,
        conversions: folder.conversions.map((item) => {
          const snap = item.snapshot as {
            transactionCount?: number;
            transactions?: Array<{
              date: string;
              description: string;
              moneyIn: number;
              moneyOut: number;
              accountNumber?: string | null;
              accountName?: string | null;
            }>;
          };
          const txs = snap.transactions ?? [];
          return {
            id: item.id,
            name: item.name,
            savedAt: item.createdAt.toISOString().slice(0, 16).replace("T", " "),
            count: snap.transactionCount ?? txs.length,
            preview: txs.slice(0, 50).map((row) => ({
              date: String(row.date).slice(0, 10),
              description: row.description,
              moneyIn: Number(row.moneyIn) || 0,
              moneyOut: Number(row.moneyOut) || 0,
              accountNumber: row.accountNumber,
              accountName: row.accountName,
            })),
          };
        }),
      }}
      backHref="/app/folders"
    />
  );
}
