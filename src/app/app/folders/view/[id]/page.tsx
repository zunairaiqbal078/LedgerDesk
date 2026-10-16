import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireOrgContext } from "@/lib/session";
import { Button, Card } from "@/components/ui";

export default async function SavedConversionViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organization } = await requireOrgContext("VIEWER");

  const saved = await prisma.savedConversion.findFirst({
    where: { id, folder: { organizationId: organization.id } },
    include: { folder: true },
  });
  if (!saved) notFound();

  const snapshot = saved.snapshot as {
    transactions?: Array<{
      date: string;
      description: string;
      moneyIn: number;
      moneyOut: number;
      accountNumber?: string | null;
      accountName?: string | null;
      province?: string | null;
      taxCodes?: string[];
      provinceTaxCodes?: string[];
      notes?: string | null;
    }>;
    organizationName?: string;
  };

  const rows = snapshot.transactions ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
            {saved.name}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Client: {snapshot.organizationName ?? organization.name} · Folder: {saved.folder.name}{" "}
            · {rows.length} transaction{rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/app/folders">
            <Button variant="secondary" size="sm">
              Back to folders
            </Button>
          </Link>
          <a href={`/api/saved-conversions/${saved.id}/download`}>
            <Button size="sm">Download CSV</Button>
          </a>
        </div>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">In</th>
              <th className="px-3 py-2">Out</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Tax</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-2 whitespace-nowrap">{row.date}</td>
                <td className="px-3 py-2">{row.description}</td>
                <td className="px-3 py-2">{row.moneyIn ? row.moneyIn.toFixed(2) : ""}</td>
                <td className="px-3 py-2">{row.moneyOut ? row.moneyOut.toFixed(2) : ""}</td>
                <td className="px-3 py-2">
                  {[row.accountNumber, row.accountName].filter(Boolean).join(" — ") || "—"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {[...(row.taxCodes ?? []), ...(row.provinceTaxCodes ?? [])].join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="p-8 text-center text-slate-500">No transactions in this save.</p>
        ) : null}
      </Card>
    </div>
  );
}
