import Link from "next/link";
import { adminToggleOrgAction, switchActiveOrganizationAction } from "@/app/actions/org";
import { Badge, Button, Card } from "@/components/ui";
import { prisma } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/session";

export default async function AdminPage() {
  await requireSuperAdmin();

  const [orgs, users, webhookCount] = await Promise.all([
    prisma.organization.findMany({
      include: {
        _count: { select: { members: true, banks: true, transactions: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.count(),
    prisma.webhookEvent.count(),
  ]);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#101820,#16232d)] px-6 py-8 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/80">
              Super Admin
            </p>
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
              Platform control
            </h1>
          </div>
          <Link href="/app">
            <Button variant="secondary">Open app</Button>
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-white/10 bg-white/5 p-5 text-white">
            <p className="text-xs uppercase tracking-wide text-slate-300">Organizations</p>
            <p className="mt-2 text-3xl font-semibold">{orgs.length}</p>
          </Card>
          <Card className="border-white/10 bg-white/5 p-5 text-white">
            <p className="text-xs uppercase tracking-wide text-slate-300">Users</p>
            <p className="mt-2 text-3xl font-semibold">{users}</p>
          </Card>
          <Card className="border-white/10 bg-white/5 p-5 text-white">
            <p className="text-xs uppercase tracking-wide text-slate-300">Webhook events</p>
            <p className="mt-2 text-3xl font-semibold">{webhookCount}</p>
          </Card>
        </div>

        <Card className="overflow-hidden border-white/10 bg-white text-slate-900">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-lg font-semibold">All organizations</h2>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Firm</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3">Banks</th>
                <th className="px-4 py-3">Transactions</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <div className="font-medium">{org.name}</div>
                    <div className="text-xs text-slate-500">{org.slug}</div>
                  </td>
                  <td className="px-4 py-3">{org._count.members}</td>
                  <td className="px-4 py-3">{org._count.banks}</td>
                  <td className="px-4 py-3">{org._count.transactions}</td>
                  <td className="px-4 py-3">
                    <Badge
                      className={
                        org.isActive
                          ? "border-teal-200 bg-teal-50 text-teal-800"
                          : "border-rose-200 bg-rose-50 text-rose-700"
                      }
                    >
                      {org.isActive ? "Active" : "Disabled"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <form action={switchActiveOrganizationAction}>
                        <input type="hidden" name="organizationId" value={org.id} />
                        <Button type="submit" size="sm" variant="secondary" disabled={!org.isActive}>
                          Open in app
                        </Button>
                      </form>
                      <form action={adminToggleOrgAction}>
                        <input type="hidden" name="organizationId" value={org.id} />
                        <input
                          type="hidden"
                          name="isActive"
                          value={org.isActive ? "false" : "true"}
                        />
                        <Button type="submit" size="sm" variant="secondary">
                          {org.isActive ? "Disable" : "Enable"}
                        </Button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {orgs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    No firms yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
