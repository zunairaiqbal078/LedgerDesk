"use client";

import { Button, Card } from "@/components/ui";

export function ImportGuardModal({
  open,
  transactionCount,
  title = "Import new statement?",
  onCancel,
  onSaveFirst,
  onDiscardAndContinue,
  discardLabel = "Clear & import new",
}: {
  open: boolean;
  transactionCount: number;
  title?: string;
  onCancel: () => void;
  onSaveFirst: () => void;
  onDiscardAndContinue: () => void;
  discardLabel?: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-950/50 p-4">
      <Card className="w-full max-w-lg p-6">
        <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">
          This client&apos;s transaction table currently has{" "}
          <strong>{transactionCount}</strong> row
          {transactionCount === 1 ? "" : "s"}. Would you like to save your work before
          continuing?
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="secondary" onClick={onSaveFirst}>
            Save conversion first
          </Button>
          <Button type="button" onClick={onDiscardAndContinue}>
            {discardLabel}
          </Button>
        </div>
      </Card>
    </div>
  );
}
