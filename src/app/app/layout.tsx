import { redirect } from "next/navigation";
import "@/styles/converter.css";
import { AppShell } from "@/components/app-shell";
import { canManageClientList, listSwitchableClients } from "@/lib/org-access";
import { findAccountantFirmMembershipForUser } from "@/lib/org-meta";
import { hasMinOrgRole, isSuperAdmin } from "@/lib/permissions";
import type { OrgRole } from "@prisma/client";
import { getMembershipContext, requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const globalRole = ((session.user as { globalRole?: string }).globalRole ??
    "USER") as "SUPER_ADMIN" | "USER";

  const context = await getMembershipContext(session.user.id);
  const firmMembership = await findAccountantFirmMembershipForUser(session.user.id);
  const clientOrganizations = await listSwitchableClients(session.user.id, globalRole);
  const isFirmStaff = Boolean(
    firmMembership && hasMinOrgRole(firmMembership.role, "BOOKKEEPER"),
  );
  const canManageClients = canManageClientList(
    isSuperAdmin(globalRole),
    firmMembership?.role ?? null,
  );

  const folders = context
    ? await prisma.folder.findMany({
        where: { organizationId: context.organization.id },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];

  if (!context) {
    if (isSuperAdmin(globalRole)) {
      redirect("/admin");
    }
    redirect("/onboarding");
  }

  if (!context.organization.isActive && !isSuperAdmin(globalRole)) {
    redirect("/login?error=org-disabled");
  }

  return (
    <AppShell
      orgName={context.organization.name}
      accountantFirmName={firmMembership?.orgName ?? null}
      activeOrgKind={context.organization.kind}
      userName={session.user.name}
      role={context.role}
      isSuperAdmin={isSuperAdmin(globalRole)}
      isFirmStaff={isFirmStaff}
      canManageClients={canManageClients}
      activeOrganizationId={context.organization.id}
      userOrganizations={clientOrganizations}
      orgRole={context.role as OrgRole}
      banks={context.banks.map((b) => ({
        id: b.id,
        name: b.name,
        type: b.type as "BANK" | "CREDIT_CARD",
        mask: b.mask,
      }))}
      activeBankId={context.activeBankId}
      folders={folders}
    >
      {children}
    </AppShell>
  );
}
