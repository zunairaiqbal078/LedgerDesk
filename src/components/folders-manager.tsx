"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  bulkDeleteSavedConversionsAction,
  createFolderAction,
  deleteFolderAction,
  deleteSavedConversionAction,
  type ActionResult,
} from "@/app/actions/saves";
import { LoadSavedConversionButton } from "@/components/load-saved-conversion-button";
import { Button, Card, Input } from "@/components/ui";

type Folder = {
  id: string;
  name: string;
  conversions: Array<{
    id: string;
    name: string;
    savedAt: string;
    count: number;
  }>;
};

export function FoldersManager({
  folders,
  canEdit,
  clientName,
  organizationId,
  focusFolderId,
}: {
  folders: Folder[];
  canEdit: boolean;
  clientName: string;
  organizationId: string;
  focusFolderId: string | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingBulk, startBulk] = useTransition();
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(
    createFolderAction,
    undefined,
  );

  useEffect(() => {
    if (state?.ok) toast.success(state.message);
    else if (state?.error) toast.error(state.error);
  }, [state]);

  useEffect(() => {
    if (!focusFolderId) return;
    const el = document.getElementById(`folder-${focusFolderId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusFolderId]);

  const allIds = folders.flatMap((f) => f.conversions.map((c) => c.id));
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggleAll() {
    setSelected((prev) => {
      if (allSelected) return new Set();
      return new Set(allIds);
    });
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function deleteSelected() {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} saved conversion(s)?`)) return;
    const fd = new FormData();
    fd.set("ids", [...selected].join(","));
    startBulk(async () => {
      const result = await bulkDeleteSavedConversionsAction(fd);
      if (result.ok) {
        toast.success(result.message ?? "Deleted");
        setSelected(new Set());
      } else toast.error(result.error ?? "Delete failed");
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Folders & Saved Conversions
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Client: <strong>{clientName}</strong>. Folder sirf container hai — andar ki files{" "}
          <strong>Save Conversion</strong> se aati hain (Transactions tab ke baad).
        </p>
      </div>

      <Card className="border-teal-100 bg-teal-50/40 p-4 text-sm text-slate-700">
        <strong>Store kaise karein:</strong> Import → categorize → top bar{" "}
        <strong>Save Conversion</strong> → folder choose → save name. Phir folder par{" "}
        <strong>Open folder</strong> ya neeche list se details dekhein.
      </Card>

      {canEdit ? (
        <Card className="p-5">
          <h2 className="mb-3 text-lg font-semibold">Create folder</h2>
          <form action={action} className="flex flex-wrap gap-2">
            <Input name="name" placeholder="e.g. 2026 Q1" className="max-w-sm" required />
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Add folder"}
            </Button>
          </form>
        </Card>
      ) : null}

      {canEdit && selected.size > 0 ? (
        <Card className="flex flex-wrap items-center gap-3 border-rose-200 bg-rose-50/50 p-4">
          <span className="text-sm font-semibold text-rose-900">{selected.size} selected</span>
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={pendingBulk}
            onClick={deleteSelected}
          >
            {pendingBulk ? "Deleting…" : "Delete selected"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </Card>
      ) : null}

      {canEdit && allIds.length > 0 ? (
        <label className="flex items-center gap-2 px-1 text-sm text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={allSelected}
            onChange={toggleAll}
          />
          Select all saved conversions
        </label>
      ) : null}

      <div className="space-y-4">
        {folders.map((folder) => (
          <Card
            key={folder.id}
            id={`folder-${folder.id}`}
            className={`overflow-hidden ${
              focusFolderId === folder.id ? "ring-2 ring-teal-600 ring-offset-2" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div>
                <h3 className="font-semibold">{folder.name}</h3>
                <p className="text-xs text-slate-500">
                  {folder.conversions.length} saved conversion
                  {folder.conversions.length === 1 ? "" : "s"}
                </p>
              </div>
              <Link href={`/app/folders/${folder.id}`}>
                <Button type="button" size="sm" variant="secondary">
                  Open folder
                </Button>
              </Link>
              {canEdit ? (
                <form
                  action={async (fd) => {
                    if (
                      !confirm(
                        `Delete folder “${folder.name}”?${
                          folder.conversions.length
                            ? " Delete its saved conversions first."
                            : ""
                        }`,
                      )
                    ) {
                      return;
                    }
                    const result = await deleteFolderAction(fd);
                    if (result.ok) toast.success(result.message);
                    else toast.error(result.error);
                  }}
                >
                  <input type="hidden" name="id" value={folder.id} />
                  <Button type="submit" size="sm" variant="danger">
                    Delete folder
                  </Button>
                </form>
              ) : null}
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {canEdit ? <th className="px-4 py-3" /> : null}
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Transactions</th>
                  <th className="px-4 py-3">Saved</th>
                  {canEdit ? <th className="px-4 py-3">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {folder.conversions.map((item) => (
                  <tr
                    key={item.id}
                    className={`border-t border-slate-100 ${selected.has(item.id) ? "bg-rose-50/40" : ""}`}
                  >
                    {canEdit ? (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={selected.has(item.id)}
                          onChange={() => toggleOne(item.id)}
                          aria-label={`Select ${item.name}`}
                        />
                      </td>
                    ) : null}
                    <td className="px-4 py-3 font-medium">{item.name}</td>
                    <td className="px-4 py-3">{item.count}</td>
                    <td className="px-4 py-3">{item.savedAt}</td>
                    {canEdit ? (
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link href={`/app/folders/view/${item.id}`}>
                            <Button type="button" size="sm" variant="secondary">
                              View
                            </Button>
                          </Link>
                          <a href={`/api/saved-conversions/${item.id}/download`}>
                            <Button type="button" size="sm" variant="secondary">
                              Download
                            </Button>
                          </a>
                          <LoadSavedConversionButton
                            organizationId={organizationId}
                            conversionId={item.id}
                          >
                            Load in workspace
                          </LoadSavedConversionButton>
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
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
                {folder.conversions.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canEdit ? 5 : 3}
                      className="px-4 py-8 text-center text-slate-500"
                    >
                      Empty —{" "}
                      <Link href="/app?tab=transactions" className="font-semibold text-teal-800">
                        import &amp; Save Conversion
                      </Link>{" "}
                      into this folder.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
        ))}
        {folders.length === 0 ? (
          <Card className="p-10 text-center text-slate-500">
            No folders yet. Create one here or while saving a conversion.
          </Card>
        ) : null}
      </div>
    </div>
  );
}
