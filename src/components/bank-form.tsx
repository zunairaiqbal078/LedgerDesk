"use client";

import { useActionState } from "react";
import { createBankAction, type ActionResult } from "@/app/actions/org";
import { Button, Input, Label, Select } from "@/components/ui";

export function CreateBankForm() {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(
    createBankAction,
    undefined,
  );

  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <div className="md:col-span-2">
        <Label htmlFor="name">Bank / card name</Label>
        <Input id="name" name="name" required placeholder="RBC Business Chequing" />
      </div>
      <div>
        <Label htmlFor="type">Type</Label>
        <Select id="type" name="type" defaultValue="BANK">
          <option value="BANK">Bank</option>
          <option value="CREDIT_CARD">Credit Card</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="mask">Last 4 (optional)</Label>
        <Input id="mask" name="mask" maxLength={4} placeholder="1234" />
      </div>
      <div>
        <Label htmlFor="institutionName">Institution</Label>
        <Input id="institutionName" name="institutionName" placeholder="RBC" />
      </div>
      <div>
        <Label htmlFor="currency">Currency</Label>
        <Input id="currency" name="currency" defaultValue="CAD" maxLength={3} />
      </div>
      {state?.error ? (
        <p className="md:col-span-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p className="md:col-span-2 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800">
          Bank added. It is now selected in the header.
        </p>
      ) : null}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add bank"}
        </Button>
      </div>
    </form>
  );
}
