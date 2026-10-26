"use client";

import { useActionState, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateMyBusinessCompanyAction, type ActionResult } from "@/app/actions/org";
import { CANADIAN_PROVINCES } from "@/lib/canada-provinces";
import { provinceTaxProfileText } from "@/lib/province-tax-profile";
import { Button, Card, Input, Label, Select } from "@/components/ui";

export type EditableCompany = {
  id: string;
  name: string;
  defaultProvince: string | null;
};

export function EditCompanyModal({
  open,
  onClose,
  company,
}: {
  open: boolean;
  onClose: () => void;
  company: EditableCompany | null;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [province, setProvince] = useState("");
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(
    updateMyBusinessCompanyAction,
    undefined,
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!company || !open) return;
    setProvince(company.defaultProvince ?? "");
  }, [company, open]);

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? "Company updated");
      onClose();
      router.refresh();
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, onClose, router]);

  if (!open || !mounted || !company) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/50 p-4">
      <Card className="relative z-[201] w-full max-w-lg p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
            Edit company
          </h2>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <form action={action} className="space-y-4" key={company.id}>
          <input type="hidden" name="companyId" value={company.id} />

          <div>
            <Label htmlFor="edit-company-name">Company name</Label>
            <Input
              id="edit-company-name"
              name="name"
              required
              minLength={2}
              defaultValue={company.name}
            />
          </div>

          <div>
            <Label htmlFor="edit-company-province">Province / Territory (optional)</Label>
            <Select
              id="edit-company-province"
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
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </Card>
    </div>,
    document.body,
  );
}
