"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { clearAllCompanyTransactionsAction } from "@/app/actions/books";

export function TaxClearAllButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClear() {
    const ok = confirm(
      "Delete ALL transactions for this company (every bank account)?\n\nGST and PST calculations will reset to $0. This cannot be undone.",
    );
    if (!ok) return;

    startTransition(async () => {
      const result = await clearAllCompanyTransactionsAction();
      if (result.ok) {
        toast.success(result.message ?? "Cleared");
        router.refresh();
      } else {
        toast.error(result.error ?? "Could not clear");
      }
    });
  }

  return (
    <button
      type="button"
      className="btn-converter btn-danger"
      disabled={pending}
      onClick={onClear}
    >
      {pending ? "Clearing…" : "Clear All"}
    </button>
  );
}
