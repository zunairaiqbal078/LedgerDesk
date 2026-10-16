import { FoldersManager } from "@/components/folders-manager";
import { prisma } from "@/lib/db";
import { canEditTransactions } from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";

export default async function FoldersPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const { folder: focusFolderId } = await searchParams;
  const { organization, role } = await requireOrgContext("VIEWER");
  const folders = await prisma.folder.findMany({
    where: { organizationId: organization.id },
    include: {
      conversions: {
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <FoldersManager
      canEdit={canEditTransactions(role)}
      clientName={organization.name}
      organizationId={organization.id}
      focusFolderId={focusFolderId ?? null}
      folders={folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        conversions: folder.conversions.map((item) => {
          const snap = item.snapshot as { transactionCount?: number; transactions?: unknown[] };
          return {
            id: item.id,
            name: item.name,
            savedAt: item.createdAt.toISOString().slice(0, 16).replace("T", " "),
            count: snap.transactionCount ?? snap.transactions?.length ?? 0,
          };
        }),
      }))}
    />
  );
}
