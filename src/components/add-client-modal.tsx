"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClientOrganizationAction, type ActionResult } from "@/app/actions/org";
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

export function AddClientModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [province, setProvince] = useState("");
  const [gstPeriods, setGstPeriods] = useState<GstPeriodDraft[]>([]);
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(
    createClientOrganizationAction,
    undefined,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? "Client created");
      onClose();
      router.refresh();
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, onClose, router]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4">
      <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">Add Client</h2>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <form action={action} className="space-y-4">
          <input type="hidden" name="gstPeriodsJson" value={JSON.stringify(gstPeriods)} />

          <div>
            <Label htmlFor="name">Client Name</Label>
            <Input id="name" name="name" required placeholder="e.g. ABC Holdings Ltd." />
          </div>

          <div>
            <Label htmlFor="province">Province / Territory</Label>
            <Select
              id="province"
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="fiscalYearStartMonth">Fiscal Year Start Month</Label>
              <Select id="fiscalYearStartMonth" name="fiscalYearStartMonth" defaultValue="1">
                {MONTHS.map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="fiscalYearStartDay">Fiscal Year Start Day</Label>
              <Input
                id="fiscalYearStartDay"
                name="fiscalYearStartDay"
                type="number"
                min={1}
                max={31}
                defaultValue={1}
              />
            </div>
            <div>
              <Label htmlFor="gstYearStartMonth">GST Year Start Month</Label>
              <Select id="gstYearStartMonth" name="gstYearStartMonth" defaultValue="1">
                {MONTHS.map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="gstYearStartDay">GST Year Start Day</Label>
              <Input
                id="gstYearStartDay"
                name="gstYearStartDay"
                type="number"
                min={1}
                max={31}
                defaultValue={1}
              />
            </div>
            <div>
              <Label htmlFor="gstFilingFrequency">GST Filing Period</Label>
              <Select id="gstFilingFrequency" name="gstFilingFrequency" defaultValue="Quarterly">
                <option value="Monthly">Monthly</option>
                <option value="Quarterly">Quarterly</option>
                <option value="Yearly">Yearly</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="pstFilingFrequency">PST Filing Period</Label>
              <Select id="pstFilingFrequency" name="pstFilingFrequency" defaultValue="Quarterly">
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
                      next[i] = { ...next[i], name: e.target.value };
                      setGstPeriods(next);
                    }}
                  />
                  <Input
                    type="date"
                    value={p.startDate}
                    onChange={(e) => {
                      const next = [...gstPeriods];
                      next[i] = { ...next[i], startDate: e.target.value };
                      setGstPeriods(next);
                    }}
                  />
                  <Input
                    type="date"
                    value={p.endDate}
                    onChange={(e) => {
                      const next = [...gstPeriods];
                      next[i] = { ...next[i], endDate: e.target.value };
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
              <p className="text-xs text-slate-500">
                Optional named periods with custom start and end dates.
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            New/imported transactions inherit the client province. Fiscal Year and GST Year remain
            separate (General Entries vs GST tab).
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create Client"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
