"use client";

import { useActionState, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createMyBusinessCompanyAction, type ActionResult } from "@/app/actions/org";
import { CANADIAN_PROVINCES } from "@/lib/canada-provinces";
import { provinceTaxProfileText } from "@/lib/province-tax-profile";
import { Button, Card, Input, Label, Select } from "@/components/ui";

export function AddCompanyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [province, setProvince] = useState("");
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(
    createMyBusinessCompanyAction,
    undefined,
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? "Company created");
      onClose();
      router.refresh();
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, onClose, router]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/50 p-4">
      <Card className="relative z-[201] w-full max-w-lg p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
            Add company
          </h2>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <p className="mb-4 text-sm text-slate-500">
          Each company has its own books, banks, and hired accountants. Switching companies in the
          sidebar never mixes data.
        </p>

        <form action={action} className="space-y-4">
          <div>
            <Label htmlFor="company-name">Company name</Label>
            <Input
              id="company-name"
              name="name"
              required
              minLength={2}
              placeholder="e.g. Metric Ltd."
            />
          </div>

          <div>
            <Label htmlFor="company-province">Province / Territory (optional)</Label>
            <Select
              id="company-province"
              name="province"
              value={province}
              onChange={(e) => setProvince(e.target.value)}
            >
              <option value="">— Select province —</option>
              {CANADIAN_PROVINCES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label} ({code})
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-slate-500">{provinceTaxProfileText(province)}</p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create company"}
            </Button>
          </div>
        </form>
      </Card>
    </div>,
    document.body,
  );
}
