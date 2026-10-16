"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { deleteTransactionsAction } from "@/app/actions/books";

export function BulkDeleteTransactionsModal({
  open,
  onClose,
  selectedIds,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: string[];
  onDeleted?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  if (!open) return null;

  function confirmDelete() {
    const formData = new FormData();
    formData.set("ids", selectedIds.join(","));
    startTransition(async () => {
      const result = await deleteTransactionsAction(formData);
      if (result.ok) {
        toast.success(result.message ?? "Deleted");
        onDeleted?.();
        onClose();
      } else toast.error(result.error ?? "Delete failed");
    });
  }

  return (
    <div className="modal open">
      <div className="modal-card" style={{ width: "min(520px, 96vw)" }}>
        <div className="modal-head">
          <h3>Delete Selected Transactions</h3>
          <button type="button" className="btn-converter btn-light btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          <p>
            Delete <strong>{selectedIds.length}</strong> selected transaction
            {selectedIds.length === 1 ? "" : "s"}? This cannot be undone.
          </p>
          <p className="hint">Use checkboxes in the table to change what is selected.</p>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn-converter btn-light" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-converter btn-light"
            style={{ color: "var(--danger)", borderColor: "#f2c8c5" }}
            disabled={pending}
            onClick={confirmDelete}
          >
            Delete Selected
          </button>
        </div>
      </div>
    </div>
  );
}
