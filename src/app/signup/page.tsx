import { Card } from "@/components/ui";
import { SignupForm, type SignupMode } from "@/components/auth-forms";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const initialMode: SignupMode = type === "client" ? "client" : "firm";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#d7ebe4,transparent_40%),linear-gradient(180deg,#f7fafb,#e8eef1)] px-4">
      <Card className="w-full max-w-lg p-8">
        <div className="mb-2">
          <p className="font-[family-name:var(--font-display)] text-2xl font-semibold text-slate-900">
            Sign up
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Choose accounting firm or my business — same email and password for both.
          </p>
        </div>
        <SignupForm initialMode={initialMode} />
      </Card>
    </div>
  );
}
