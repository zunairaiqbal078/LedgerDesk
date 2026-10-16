import type {
  BankAccount,
  GlobalRole,
  OrgRole,
  Organization,
  OrganizationKind,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  findAccountantFirmMembershipForUser,
  getOrganizationFirmParentId,
  listAllClientOrganizations,
  listClientOrganizationsUnderFirm,
  listDirectClientMembershipsForUser,
} from "@/lib/org-meta";
import { hasMinOrgRole, isSuperAdmin } from "@/lib/permissions";

export type ResolvedOrgAccess = {
  organization: Organization & {
    kind: OrganizationKind;
    firmOrganizationId: string | null;
    banks: Pick<
      BankAccount,
      "id" | "name" | "type" | "mask" | "currency" | "isArchived"
    >[];
  };
  role: OrgRole;
  viaFirm: boolean;
};

type OrganizationWithBanks = Organization & {
  banks: Pick<
    BankAccount,
    "id" | "name" | "type" | "mask" | "currency" | "isArchived"
  >[];
};

async function hydrateOrganizationScalars(
  organization: OrganizationWithBanks,
): Promise<ResolvedOrgAccess["organization"]> {
  const { getOrganizationDefaultProvince, getOrganizationKind } = await import(
    "@/lib/org-meta"
  );
  const [kind, firmOrganizationId, defaultProvince] = await Promise.all([
    getOrganizationKind(organization.id),
    getOrganizationFirmParentId(organization.id),
    getOrganizationDefaultProvince(organization.id),
  ]);
  return {
    ...organization,
    kind: kind ?? "CLIENT",
    firmOrganizationId,
    defaultProvince,
  };
}

export async function userCanAccessOrganization(
  userId: string,
  organizationId: string,
  globalRole: GlobalRole,
): Promise<boolean> {
  if (isSuperAdmin(globalRole)) return true;

  const direct = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (direct) return true;

  const firmOrganizationId = await getOrganizationFirmParentId(organizationId);
  if (!firmOrganizationId) return false;

  const firmMembership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: firmOrganizationId,
        userId,
      },
    },
  });
  return Boolean(firmMembership && hasMinOrgRole(firmMembership.role, "BOOKKEEPER"));
}

export async function resolveOrganizationAccess(
  userId: string,
  organizationId: string,
  globalRole: GlobalRole,
): Promise<ResolvedOrgAccess | null> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      banks: {
        where: { isArchived: false },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!organization) return null;

  const hydrated = await hydrateOrganizationScalars(organization);

  const direct = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (direct) {
    return { organization: hydrated, role: direct.role, viaFirm: false };
  }

  if (hydrated.firmOrganizationId) {
    const firmMembership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: hydrated.firmOrganizationId,
          userId,
        },
      },
    });
    if (firmMembership && hasMinOrgRole(firmMembership.role, "BOOKKEEPER")) {
      return { organization: hydrated, role: firmMembership.role, viaFirm: true };
    }
  }

  if (isSuperAdmin(globalRole)) {
    return { organization: hydrated, role: "OWNER", viaFirm: false };
  }

  return null;
}

export async function listSwitchableClients(
  userId: string,
  globalRole: GlobalRole,
): Promise<
  Array<{ id: string; name: string; slug: string; isActive: boolean; role: string }>
> {
  if (isSuperAdmin(globalRole)) {
    const rows = await listAllClientOrganizations();
    return rows.map((r) => ({ ...r, role: "SUPER_ADMIN" }));
  }

  const firmMembership = await findAccountantFirmMembershipForUser(userId);

  if (firmMembership && hasMinOrgRole(firmMembership.role, "BOOKKEEPER")) {
    const rows = await listClientOrganizationsUnderFirm(firmMembership.organizationId);
    return rows.map((r) => ({ ...r, role: firmMembership.role }));
  }

  const memberships = await listDirectClientMembershipsForUser(userId);
  return memberships.map((m) => ({
    id: m.id,
    name: m.name,
    slug: m.slug,
    isActive: m.isActive,
    role: m.role,
  }));
}

export function canManageClientList(
  isSuperAdmin: boolean,
  firmMembershipRole: OrgRole | null,
) {
  if (isSuperAdmin) return true;
  if (firmMembershipRole && hasMinOrgRole(firmMembershipRole, "ADMIN")) return true;
  return false;
}

export function organizationKindLabel(kind: OrganizationKind) {
  return kind === "ACCOUNTANT_FIRM" ? "Accounting firm" : "Client";
}
