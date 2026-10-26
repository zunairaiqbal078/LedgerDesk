import { redirect } from "next/navigation";
import "@/styles/converter.css";
import { AppShell } from "@/components/app-shell";
import { canManageClientList, listSwitchableClients } from "@/lib/org-access";
import { findAccountantFirmMembershipForUser } from "@/lib/org-meta";
import { hasMinOrgRole, isSuperAdmin } from "@/lib/permissions";
import type { OrgRole } from "@prisma/client";
import { getMembershipContext, requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";

/** Large scanned-PDF imports via Server Actions need headroom on Vercel. */
export const maxDuration = 60;

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

  const canManageMyCompanies =
    !isFirmStaff &&
    !isSuperAdmin(globalRole) &&
    context.organization.kind === "CLIENT" &&
    !context.organization.firmOrganizationId &&
    hasMinOrgRole(context.role as OrgRole, "OWNER");

  const editableClient =
    canManageClients &&
    context.organization.kind === "CLIENT" &&
    context.organization.firmOrganizationId
      ? await prisma.organization.findUnique({
          where: { id: context.organization.id },
          select: {
            id: true,
            name: true,
            defaultProvince: true,
            fiscalYearStartMonth: true,
            fiscalYearStartDay: true,
            gstYearStartMonth: true,
            gstYearStartDay: true,
            gstFilingFrequency: true,
            pstFilingFrequency: true,
            gstPeriods: {
              orderBy: { startDate: "asc" },
              select: { name: true, startDate: true, endDate: true },
            },
          },
        })
      : null;

  const editableCompany = canManageMyCompanies
    ? {
        id: context.organization.id,
        name: context.organization.name,
        defaultProvince: context.organization.defaultProvince ?? null,
      }
    : null;

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
      canManageMyCompanies={canManageMyCompanies}
      activeOrganizationId={context.organization.id}
      userOrganizations={clientOrganizations}
      orgRole={context.role as OrgRole}
      editableClient={
        editableClient
          ? {
              id: editableClient.id,
              name: editableClient.name,
              defaultProvince: editableClient.defaultProvince,
              fiscalYearStartMonth: editableClient.fiscalYearStartMonth,
              fiscalYearStartDay: editableClient.fiscalYearStartDay,
              gstYearStartMonth: editableClient.gstYearStartMonth,
              gstYearStartDay: editableClient.gstYearStartDay,
              gstFilingFrequency: editableClient.gstFilingFrequency,
              pstFilingFrequency: editableClient.pstFilingFrequency,
              gstPeriods: editableClient.gstPeriods.map((p) => ({
                name: p.name,
                startDate: p.startDate.toISOString().slice(0, 10),
                endDate: p.endDate.toISOString().slice(0, 10),
              })),
            }
          : null
      }
      editableCompany={editableCompany}
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
