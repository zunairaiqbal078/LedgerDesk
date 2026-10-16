"use client";

import { useActionState } from "react";
import {
  changePasswordAction,
  createTeamMemberAction,
  updateProfileAction,
  type ActionResult,
} from "@/app/actions/org";
import { Button, Input, Label, Select } from "@/components/ui";

export function CreateTeamMemberForm() {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(
    createTeamMemberAction,
    undefined,
  );

  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <div>
        <Label htmlFor="name">Full name</Label>
        <Input id="name" name="name" required />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div>
        <Label htmlFor="password">Temporary password</Label>
        <Input id="password" name="password" type="password" required minLength={10} />
      </div>
      <div>
        <Label htmlFor="role">Role</Label>
        <Select id="role" name="role" defaultValue="BOOKKEEPER">
          <option value="ADMIN">Admin</option>
          <option value="BOOKKEEPER">Bookkeeper</option>
          <option value="VIEWER">Viewer</option>
        </Select>
      </div>
      <p className="md:col-span-2 text-xs text-slate-500">
        No email invite is sent. Share the email and password with your teammate manually.
      </p>
      {state?.error ? (
        <p className="md:col-span-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p className="md:col-span-2 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800">
          Team member created. Share credentials securely.
        </p>
      ) : null}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Add team member"}
        </Button>
      </div>
    </form>
  );
}

export function ProfileForm({ defaultName }: { defaultName: string }) {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(
    updateProfileAction,
    undefined,
  );

  return (
    <form action={action} className="space-y-3">
      <div>
        <Label htmlFor="name">Display name</Label>
        <Input id="name" name="name" defaultValue={defaultName} required />
      </div>
      {state?.ok ? (
        <p className="text-sm text-teal-700">Profile updated.</p>
      ) : null}
      {state?.error ? <p className="text-sm text-rose-700">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        Save profile
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(
    changePasswordAction,
    undefined,
  );

  return (
    <form action={action} className="space-y-3">
      <div>
        <Label htmlFor="currentPassword">Current password</Label>
        <Input id="currentPassword" name="currentPassword" type="password" required />
      </div>
      <div>
        <Label htmlFor="newPassword">New password</Label>
        <Input id="newPassword" name="newPassword" type="password" required minLength={10} />
      </div>
      <div>
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" required minLength={10} />
      </div>
      {state?.ok ? <p className="text-sm text-teal-700">Password changed.</p> : null}
      {state?.error ? <p className="text-sm text-rose-700">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        Update password
      </Button>
    </form>
  );
}
