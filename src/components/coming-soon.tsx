import { Card } from "@/components/ui";

export default function ComingSoonPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <Card className="p-10">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal-800">
          Phase foundation ready
        </p>
        <p className="mt-3 max-w-2xl text-slate-600">
          Auth, org isolation, banks, rules seed data, settings/team, middleware, and webhook
          intake are live. This module will be wired next with the same HTML feature parity.
        </p>
      </Card>
    </div>
  );
}
