import { Suspense } from "react";
import { Card } from "@/components/ui";
import { LoginForm } from "@/components/auth-forms";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#d7ebe4,transparent_40%),linear-gradient(180deg,#f7fafb,#e8eef1)] px-4">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6">
          <p className="font-[family-name:var(--font-display)] text-2xl font-semibold text-slate-900">
            Welcome back
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Accountants, team members, and business owners — use your signup email and password.
          </p>
        </div>
        <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
          <LoginForm />
        </Suspense>
      </Card>
    </div>
  );
}
