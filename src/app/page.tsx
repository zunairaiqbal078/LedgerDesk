import Link from "next/link";
import { Button } from "@/components/ui";

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0c2428] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(45,160,140,0.35),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(214,186,120,0.2),transparent_30%),linear-gradient(180deg,#0c2428_0%,#12343a_55%,#0c2428_100%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8">
        <header className="flex items-center justify-between">
          <div className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
            LedgerDesk
          </div>
          <Link href="/login">
            <Button variant="secondary">Login</Button>
          </Link>
        </header>

        <section className="flex flex-1 flex-col justify-center gap-8 py-16">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-200/80">
            Canadian bookkeeping OS
          </p>
          <h1 className="max-w-3xl font-[family-name:var(--font-display)] text-5xl leading-[1.05] font-semibold md:text-6xl">
            Convert statements. Categorize by bank. Close the books with confidence.
          </h1>
          <p className="max-w-2xl text-lg text-teal-50/75">
            Multi-tenant platform for accounting firms: secure org isolation, role-based team
            access, predefined rules, GST/PST workflows, and production-grade middleware.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/login">
              <Button size="lg">Login</Button>
            </Link>
            <Link href="/signup">
              <Button size="lg" variant="secondary">
                Signup
              </Button>
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
