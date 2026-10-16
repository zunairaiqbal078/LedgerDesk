import Link from "next/link";
import { Button, Card } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";

export default async function OnboardingPage() {
  const session = await requireSession();
  const membership = await prisma.membership.findFirst({
    where: { userId: session.user.id },
  });
  if (membership) redirect("/app");

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#eef3f5] px-4">
      <Card className="w-full max-w-lg p-8 text-center">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          No client access yet
        </h1>
        <p className="mt-3 text-sm text-slate-500">
          Ask your accountant to add you to their firm, or register as an accounting firm to manage
          client books.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/signup">
            <Button>Register accounting firm</Button>
          </Link>
          <Link href="/login">
            <Button variant="secondary">Back to login</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
