"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { signupAction, type ActionResult } from "@/app/actions/org";
import { Button, Input, Label } from "@/components/ui";

export type SignupMode = "firm" | "client";

export function LoginForm() {
  const searchParams = useSearchParams();
  const authError = searchParams.get("error");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const { error } = await authClient.signIn.email({
      email,
      password,
      callbackURL: "/app",
    });
    if (error) {
      alert(error.message ?? "Login failed");
      return;
    }
    window.location.href = "/app";
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {authError === "session" ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Session expire ho gayi ya invalid hai. Dubara sign in karein. Agar bar bar aaye to browser
          cookies clear karein ya DB check karein (<code className="text-xs">npm run db:up</code>).
        </p>
      ) : null}
      {authError === "banned" ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          This account is disabled.
        </p>
      ) : null}
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>
      <Button type="submit" className="w-full">
        Sign in
      </Button>
      <p className="text-center text-sm text-slate-500">
        No account?{" "}
        <Link href="/signup" className="font-semibold text-teal-800 hover:underline">
          Sign up
        </Link>
      </p>
    </form>
  );
}

const SIGNUP_COPY: Record<
  SignupMode,
  { title: string; subtitle: string; orgLabel: string; orgPlaceholder: string; submit: string; pending: string }
> = {
  firm: {
    title: "Accounting firm",
    subtitle: "Manage multiple client books. Add clients from the sidebar after signup.",
    orgLabel: "Accounting firm name",
    orgPlaceholder: "Northshore Bookkeeping Inc.",
    submit: "Create firm account",
    pending: "Creating firm…",
  },
  client: {
    title: "My business",
    subtitle: "For owners and bookkeepers using LedgerDesk for one company — no client switcher.",
    orgLabel: "Business / company name",
    orgPlaceholder: "Acme Plumbing Ltd.",
    submit: "Create my account",
    pending: "Creating account…",
  },
};

export function SignupForm({ initialMode = "firm" }: { initialMode?: SignupMode }) {
  const [mode, setMode] = useState<SignupMode>(initialMode);
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(
    signupAction,
    undefined,
  );
  const copy = SIGNUP_COPY[mode];

  return (
    <div className="space-y-5">
      <div
        className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1"
        role="tablist"
        aria-label="Sign up as"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "firm"}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            mode === "firm"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
          onClick={() => setMode("firm")}
        >
          Accounting firm
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "client"}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            mode === "client"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
          onClick={() => setMode("client")}
        >
          My business
        </button>
      </div>

      <div>
        <p className="font-[family-name:var(--font-display)] text-xl font-semibold text-slate-900">
          {copy.title}
        </p>
        <p className="mt-1 text-sm text-slate-500">{copy.subtitle}</p>
      </div>

      <form action={action} className="space-y-4">
        <input type="hidden" name="accountType" value={mode === "client" ? "client" : "firm"} />
        <div>
          <Label htmlFor={mode === "firm" ? "firmName" : "businessName"}>{copy.orgLabel}</Label>
          {mode === "firm" ? (
            <Input
              id="firmName"
              name="firmName"
              required
              key="firmName"
              placeholder={copy.orgPlaceholder}
            />
          ) : (
            <Input
              id="businessName"
              name="businessName"
              required
              key="businessName"
              placeholder={copy.orgPlaceholder}
            />
          )}
        </div>
        <div>
          <Label htmlFor="name">Your full name</Label>
          <Input id="name" name="name" required autoComplete="name" />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <Label htmlFor="password">Password (min 10 characters)</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
          />
        </div>
        {state?.error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? copy.pending : copy.submit}
        </Button>
        <p className="text-center text-sm text-slate-500">
          Already have access?{" "}
          <Link href="/login" className="font-semibold text-teal-800 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
