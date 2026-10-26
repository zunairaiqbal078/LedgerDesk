"use client";

import { useActionState, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateClientOrganizationAction, type ActionResult } from "@/app/actions/org";
import { CANADIAN_PROVINCES } from "@/lib/canada-provinces";
import { provinceTaxProfileText } from "@/lib/province-tax-profile";
import { Button, Card, Input, Label, Select } from "@/components/ui";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type GstPeriodDraft = { name: string; startDate: string; endDate: string };

export type EditableClient = {
  id: string;
  name: string;
  defaultProvince: string | null;
  fiscalYearStartMonth: number;
  fiscalYearStartDay: number;
  gstYearStartMonth: number;
  gstYearStartDay: number;
  gstFilingFrequency: string;
  pstFilingFrequency: string;
  gstPeriods: GstPeriodDraft[];
};

function filingToHtml(value: string) {
  const v = value.toUpperCase();
  if (v === "MONTHLY") return "Monthly";
  if (v === "YEARLY") return "Yearly";
  return "Quarterly";
}

export function EditClientModal({
  open,
  onClose,
  client,
}: {
  open: boolean;
  onClose: () => void;
  client: EditableClient | null;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [province, setProvince] = useState("");
  const [gstPeriods, setGstPeriods] = useState<GstPeriodDraft[]>([]);
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(
    updateClientOrganizationAction,
    undefined,
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!client || !open) return;
    setProvince(client.defaultProvince ?? "");
    setGstPeriods(client.gstPeriods ?? []);
  }, [client, open]);

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? "Client updated");
      onClose();
      router.refresh();
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, onClose, router]);

  if (!open || !mounted || !client) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/50 p-4">
      <Card className="relative z-[201] max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
            Edit Client
          </h2>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <form action={action} className="space-y-4" key={client.id}>
          <input type="hidden" name="clientId" value={client.id} />
          <input type="hidden" name="gstPeriodsJson" value={JSON.stringify(gstPeriods)} />

          <div>
            <Label htmlFor="edit-client-name">Client Name</Label>
            <Input
              id="edit-client-name"
              name="name"
              required
              minLength={2}
              defaultValue={client.name}
            />
          </div>

          <div>
            <Label htmlFor="edit-client-province">Province / Territory</Label>
            <Select
              id="edit-client-province"
              name="province"
              value={province}
              onChange={(e) => setProvince(e.target.value)}
            >
              <option value="">None</option>
              {CANADIAN_PROVINCES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label} ({code})
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-slate-500">{provinceTaxProfileText(province)}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="edit-fy-month">Fiscal Year Start Month</Label>
              <Select
                id="edit-fy-month"
                name="fiscalYearStartMonth"
                defaultValue={String(client.fiscalYearStartMonth || 1)}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-fy-day">Fiscal Year Start Day</Label>
              <Input
                id="edit-fy-day"
                name="fiscalYearStartDay"
                type="number"
                min={1}
                max={31}
                defaultValue={client.fiscalYearStartDay || 1}
              />
            </div>
            <div>
              <Label htmlFor="edit-gst-month">GST Year Start Month</Label>
              <Select
                id="edit-gst-month"
                name="gstYearStartMonth"
                defaultValue={String(client.gstYearStartMonth || 1)}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-gst-day">GST Year Start Day</Label>
              <Input
                id="edit-gst-day"
                name="gstYearStartDay"
                type="number"
                min={1}
                max={31}
                defaultValue={client.gstYearStartDay || 1}
              />
            </div>
            <div>
              <Label htmlFor="edit-gst-freq">GST Filing Period</Label>
              <Select
                id="edit-gst-freq"
                name="gstFilingFrequency"
                defaultValue={filingToHtml(client.gstFilingFrequency)}
              >
                <option value="Monthly">Monthly</option>
                <option value="Quarterly">Quarterly</option>
                <option value="Yearly">Yearly</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-pst-freq">PST Filing Period</Label>
              <Select
                id="edit-pst-freq"
                name="pstFilingFrequency"
                defaultValue={filingToHtml(client.pstFilingFrequency)}
              >
                <option value="Monthly">Monthly</option>
                <option value="Quarterly">Quarterly</option>
                <option value="Yearly">Yearly</option>
              </Select>
            </div>
          </div>

          <div>
            <Label>GST Periods (optional)</Label>
            <div className="space-y-2 rounded-lg border border-slate-200 p-3">
              {gstPeriods.map((p, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <Input
                    placeholder="Period name"
                    value={p.name}
                    onChange={(e) => {
                      const next = [...gstPeriods];
                      next[i] = { ...next[i]!, name: e.target.value };
                      setGstPeriods(next);
                    }}
                  />
                  <Input
                    type="date"
                    value={p.startDate}
                    onChange={(e) => {
                      const next = [...gstPeriods];
                      next[i] = { ...next[i]!, startDate: e.target.value };
                      setGstPeriods(next);
                    }}
                  />
                  <Input
                    type="date"
                    value={p.endDate}
                    onChange={(e) => {
                      const next = [...gstPeriods];
                      next[i] = { ...next[i]!, endDate: e.target.value };
                      setGstPeriods(next);
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => setGstPeriods(gstPeriods.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  setGstPeriods([...gstPeriods, { name: "", startDate: "", endDate: "" }])
                }
              >
                + Add GST Period
              </Button>
            </div>
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
