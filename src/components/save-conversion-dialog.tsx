"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveConversionAction, type ActionResult } from "@/app/actions/saves";
import { Button, Card, Input, Label, Select } from "@/components/ui";
import {
  clearLoadedConversionContext,
  LAST_SAVED_CONVERSION_KEY,
  type LoadedConversionContext,
  preferredFolderStorageKey,
  readLoadedConversionContext,
  writeLoadedConversionContext,
} from "@/lib/conversion-export";

type FolderOption = { id: string; name: string };

type SaveStep = "choose" | "update" | "new";

export function SaveConversionDialog({
  open,
  onClose,
  folders,
  organizationId,
  activeBankId,
  transactionCount,
  initialLoadedContext,
}: {
  open: boolean;
  onClose: () => void;
  folders: FolderOption[];
  organizationId: string;
  activeBankId: string | null;
  transactionCount: number;
  initialLoadedContext?: LoadedConversionContext | null;
}) {
  const [loadedContext, setLoadedContext] = useState<LoadedConversionContext | null>(null);
  const [step, setStep] = useState<SaveStep>("new");
  const [folderId, setFolderId] = useState(folders[0]?.id ?? "__new__");
  const [saveName, setSaveName] = useState("");
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(
    saveConversionAction,
    undefined,
  );

  useEffect(() => {
    if (!open) return;
    const ctx =
      initialLoadedContext ?? readLoadedConversionContext(organizationId);
    setLoadedContext(ctx);
    if (ctx) {
      setStep("choose");
      setSaveName(ctx.conversionName);
      setFolderId(ctx.folderId);
    } else {
      setStep("new");
      setSaveName("");
      const stored = localStorage.getItem(preferredFolderStorageKey(organizationId));
      if (stored && (stored === "__new__" || folders.some((f) => f.id === stored))) {
        setFolderId(stored);
      } else {
        setFolderId(folders[0]?.id ?? "__new__");
      }
    }
  }, [open, folders, organizationId, initialLoadedContext]);

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? "Saved");
      if (state.id && state.message) {
        localStorage.setItem(
          LAST_SAVED_CONVERSION_KEY,
          JSON.stringify({ id: state.id, message: state.message, at: Date.now() }),
        );
        window.dispatchEvent(new CustomEvent("ledgerdesk:last-saved-conversion"));
      }
      if (step === "new" && loadedContext) {
        clearLoadedConversionContext(organizationId);
        setLoadedContext(null);
      } else if (step === "update" && loadedContext && state.id) {
        writeLoadedConversionContext({
          ...loadedContext,
          conversionName: saveName.trim() || loadedContext.conversionName,
        });
      }
      onClose();
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, onClose, step, loadedContext, organizationId, saveName]);

  if (!open) return null;

  const showChoose = loadedContext && step === "choose";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <Card className="w-full max-w-lg p-6">
        {showChoose ? (
          <>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
              Save your changes
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              You loaded <strong>{loadedContext.conversionName}</strong> from folder{" "}
              <strong>{loadedContext.folderName}</strong>. How would you like to save?
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Button type="button" onClick={() => setStep("update")}>
                Update existing save
              </Button>
              <Button type="button" variant="secondary" onClick={() => setStep("new")}>
                Save as new copy
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
              {step === "update" ? "Update saved conversion" : "Save conversion"}
            </h2>
            {step !== "update" ? (
              <p className="mt-1 text-sm text-slate-600">
                Choose a folder and name for this snapshot of your work. You can reopen it later
                from <strong>Folders</strong>.
              </p>
            ) : null}
            <p className="mt-2 text-sm text-slate-500">
              {activeBankId ? (
                <>
                  <strong>{transactionCount}</strong> transaction
                  {transactionCount === 1 ? "" : "s"} from the{" "}
                  <strong>currently selected bank</strong> will be stored.
                </>
              ) : (
                <>
                  <strong>{transactionCount}</strong> transaction
                  {transactionCount === 1 ? "" : "s"} from{" "}
                  <strong>all bank accounts</strong> for this client will be stored.
                </>
              )}
              {step === "update" && loadedContext ? (
                <>
                  {" "}
                  This replaces <strong>{loadedContext.conversionName}</strong> in folder{" "}
                  <strong>{loadedContext.folderName}</strong>.
                </>
              ) : null}
            </p>

            <form action={action} className="mt-5 space-y-4">
              {activeBankId ? (
                <input type="hidden" name="bankAccountId" value={activeBankId} />
              ) : null}
              {step === "update" && loadedContext ? (
                <>
                  <input type="hidden" name="updateConversionId" value={loadedContext.conversionId} />
                  <input type="hidden" name="folderId" value={loadedContext.folderId} />
                </>
              ) : null}

              <div>
                <Label htmlFor="name">Save name</Label>
                <Input
                  id="name"
                  name="name"
                  required
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="e.g. RBC February 2026"
                />
              </div>

              {step !== "update" ? (
                <>
                  <div>
                    <Label htmlFor="folderId">Folder</Label>
                    <Select
                      id="folderId"
                      name="folderId"
                      value={folderId}
                      onChange={(e) => setFolderId(e.target.value)}
                    >
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                      <option value="__new__">+ Create new folder…</option>
                    </Select>
                  </div>

                  {folderId === "__new__" ? (
                    <div>
                      <Label htmlFor="newFolderName">New folder name</Label>
                      <Input
                        id="newFolderName"
                        name="newFolderName"
                        required
                        placeholder="e.g. 2026 Statements"
                      />
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Folder: <strong>{loadedContext?.folderName}</strong>
                </p>
              )}

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                {loadedContext ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setStep(loadedContext ? "choose" : "new")}
                  >
                    Back
                  </Button>
                ) : null}
                <Button type="button" variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || transactionCount === 0}>
                  {pending
                    ? "Saving…"
                    : step === "update"
                      ? "Update save"
                      : "Save in selected folder"}
                </Button>
              </div>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
