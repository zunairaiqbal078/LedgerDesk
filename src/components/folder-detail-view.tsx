"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { DualScrollArea } from "@/components/dual-scroll-area";
import { Button, Card } from "@/components/ui";
import { deleteSavedConversionAction } from "@/app/actions/saves";
import { LoadSavedConversionButton } from "@/components/load-saved-conversion-button";

type PreviewRow = {
  date: string;
  description: string;
  moneyIn: number;
  moneyOut: number;
  accountNumber?: string | null;
  accountName?: string | null;
};

type ConversionItem = {
  id: string;
  name: string;
  savedAt: string;
  count: number;
  preview: PreviewRow[];
};

export function FolderDetailView({
  folder,
  clientName,
  organizationId,
  canEdit,
  backHref,
}: {
  folder: { id: string; name: string; conversions: ConversionItem[] };
  clientName: string;
  organizationId: string;
  canEdit: boolean;
  backHref: string;
}) {
  const empty = folder.conversions.length === 0;
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <Link href={backHref} className="text-sm font-semibold text-teal-800 hover:underline">
          ← All folders
        </Link>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold">
          {folder.name}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Client: <strong>{clientName}</strong> · {folder.conversions.length} saved conversion
          {folder.conversions.length === 1 ? "" : "s"}
        </p>
      </div>

      {empty ? (
        <Card className="space-y-4 p-8">
          <h2 className="text-lg font-semibold text-slate-900">This folder is empty</h2>
          <p className="text-sm text-slate-600">
            Creating a folder only adds a place to organize saves. Import and categorize a
            statement first, then use <strong>Save Conversion</strong> to store it here.
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-600">
            <li>
              Open{" "}
              <Link href="/app?tab=transactions" className="font-semibold text-teal-800 hover:underline">
                Transactions
              </Link>{" "}
              and import a statement
            </li>
            <li>Categorize accounts and tax</li>
            <li>
              Click <strong>Save Conversion</strong> in the top bar → choose folder{" "}
              <strong>{folder.name}</strong> → enter a save name
            </li>
            <li>Return here — your save will appear in the list</li>
          </ol>
          {canEdit ? (
            <Link href="/app?tab=transactions">
              <Button>Go import &amp; save</Button>
            </Link>
          ) : null}
        </Card>
      ) : (
        <div className="space-y-4">
          {folder.conversions.map((item) => {
            const open = expandedId === item.id;
            return (
              <Card key={item.id} className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                  <div>
                    <p className="font-semibold text-slate-900">{item.name}</p>
                    <p className="text-xs text-slate-500">
                      {item.count} transactions · saved {item.savedAt}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setExpandedId(open ? null : item.id)}
                    >
                      {open ? "Hide transactions" : "Show transactions"}
                    </Button>
                    <Link href={`/app/folders/view/${item.id}`}>
                      <Button type="button" size="sm" variant="secondary">
                        Full view
                      </Button>
                    </Link>
                    <a href={`/api/saved-conversions/${item.id}/download`}>
                      <Button type="button" size="sm" variant="secondary">
                        Download
                      </Button>
                    </a>
                    {canEdit ? (
                      <>
                        <LoadSavedConversionButton
                          organizationId={organizationId}
                          conversionId={item.id}
                        />
                        <form
                          action={async (fd) => {
                            if (!confirm(`Delete “${item.name}”?`)) return;
                            const result = await deleteSavedConversionAction(fd);
                            if (result.ok) toast.success(result.message);
                            else toast.error(result.error);
                          }}
                        >
                          <input type="hidden" name="id" value={item.id} />
                          <Button type="submit" size="sm" variant="danger">
                            Delete
                          </Button>
                        </form>
                      </>
                    ) : null}
                  </div>
                </div>
                {open ? (
                  <div>
                    <DualScrollArea className="card-table" style={{ border: "none", borderRadius: 0 }}>
                      <table className="w-full min-w-[640px] text-left text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2">Description</th>
                            <th className="px-3 py-2">In</th>
                            <th className="px-3 py-2">Out</th>
                            <th className="px-3 py-2">Account</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.preview.map((row, i) => (
                            <tr key={i} className="border-t border-slate-100">
                              <td className="px-3 py-2 whitespace-nowrap">{row.date}</td>
                              <td className="px-3 py-2">{row.description}</td>
                              <td className="px-3 py-2">{row.moneyIn ? row.moneyIn.toFixed(2) : ""}</td>
                              <td className="px-3 py-2">{row.moneyOut ? row.moneyOut.toFixed(2) : ""}</td>
                              <td className="px-3 py-2">
                                {[row.accountNumber, row.accountName].filter(Boolean).join(" — ") || "—"}
                              </td>
                            </tr>
                          ))}
                          {!item.preview.length ? (
                            <tr>
                              <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                                No transactions in snapshot.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </DualScrollArea>
                    {item.count > item.preview.length ? (
                      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                        Showing first {item.preview.length} of {item.count}. Open{" "}
                        <Link href={`/app/folders/view/${item.id}`} className="font-semibold text-teal-800">
                          full view
                        </Link>{" "}
                        for all rows.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
