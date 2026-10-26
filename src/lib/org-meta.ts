import { Prisma } from "@prisma/client";
import type { OrganizationKind, OrgRole } from "@prisma/client";
import { prisma } from "@/lib/db";

export type ClientOrgRow = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
};

/** Raw SQL for org kind / firm link — works even when a stale bundled Prisma DMMF lacks new columns. */
export async function getOrganizationKind(
  organizationId: string,
): Promise<OrganizationKind | null> {
  const rows = await prisma.$queryRaw<Array<{ kind: OrganizationKind }>>(Prisma.sql`
    SELECT kind::text AS kind FROM "Organization" WHERE id = ${organizationId} LIMIT 1
  `);
  return rows[0]?.kind ?? null;
}

export async function getOrganizationDefaultProvince(
  organizationId: string,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ defaultProvince: string | null }>>(Prisma.sql`
    SELECT "defaultProvince" FROM "Organization" WHERE id = ${organizationId} LIMIT 1
  `);
  const value = rows[0]?.defaultProvince?.trim() || null;
  return value;
}

export async function getOrganizationStarterChartVisible(
  organizationId: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ starterChartVisible: boolean }>>(Prisma.sql`
    SELECT "starterChartVisible" FROM "Organization" WHERE id = ${organizationId} LIMIT 1
  `);
  return rows[0]?.starterChartVisible ?? false;
}

export async function setOrganizationStarterChartVisible(
  organizationId: string,
  visible: boolean,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Organization"
    SET "starterChartVisible" = ${visible}
    WHERE id = ${organizationId}
  `;
}

export async function getOrganizationStarterRulesVisible(
  organizationId: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ starterRulesVisible: boolean }>>(Prisma.sql`
    SELECT "starterRulesVisible" FROM "Organization" WHERE id = ${organizationId} LIMIT 1
  `);
  return rows[0]?.starterRulesVisible ?? false;
}

export async function setOrganizationStarterRulesVisible(
  organizationId: string,
  visible: boolean,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Organization"
    SET "starterRulesVisible" = ${visible}
    WHERE id = ${organizationId}
  `;
}

export async function getOrganizationFirmParentId(
  organizationId: string,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ firmOrganizationId: string | null }>>(Prisma.sql`
    SELECT "firmOrganizationId" FROM "Organization" WHERE id = ${organizationId} LIMIT 1
  `);
  return rows[0]?.firmOrganizationId ?? null;
}

export async function getFirstActiveClientIdUnderFirm(
  firmOrganizationId: string,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM "Organization"
    WHERE "firmOrganizationId" = ${firmOrganizationId}
      AND "isActive" = true
      AND kind = 'CLIENT'::"OrganizationKind"
    ORDER BY name ASC
    LIMIT 1
  `);
  return rows[0]?.id ?? null;
}

export async function listAllClientOrganizations(): Promise<ClientOrgRow[]> {
  return prisma.$queryRaw<ClientOrgRow[]>(Prisma.sql`
    SELECT id, name, slug, "isActive"
    FROM "Organization"
    WHERE kind = 'CLIENT'::"OrganizationKind"
    ORDER BY name ASC
  `);
}

export async function listClientOrganizationsUnderFirm(
  firmOrganizationId: string,
): Promise<ClientOrgRow[]> {
  return prisma.$queryRaw<ClientOrgRow[]>(Prisma.sql`
    SELECT id, name, slug, "isActive"
    FROM "Organization"
    WHERE kind = 'CLIENT'::"OrganizationKind"
      AND "firmOrganizationId" = ${firmOrganizationId}
    ORDER BY name ASC
  `);
}

export async function findAccountantFirmMembershipForUser(userId: string): Promise<{
  organizationId: string;
  role: OrgRole;
  orgName: string;
} | null> {
  const rows = await prisma.$queryRaw<
    Array<{ organizationId: string; role: OrgRole; orgName: string }>
  >(Prisma.sql`
    SELECT m."organizationId", m.role::text AS role, o.name AS "orgName"
    FROM "Membership" m
    INNER JOIN "Organization" o ON o.id = m."organizationId"
    WHERE m."userId" = ${userId}
      AND o.kind = 'ACCOUNTANT_FIRM'::"OrganizationKind"
    ORDER BY o.name ASC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function listDirectClientMembershipsForUser(userId: string): Promise<
  Array<ClientOrgRow & { role: OrgRole }>
> {
  return prisma.$queryRaw<Array<ClientOrgRow & { role: OrgRole }>>(Prisma.sql`
    SELECT o.id, o.name, o.slug, o."isActive", m.role::text AS role
    FROM "Membership" m
    INNER JOIN "Organization" o ON o.id = m."organizationId"
    WHERE m."userId" = ${userId}
      AND o.kind = 'CLIENT'::"OrganizationKind"
    ORDER BY o.name ASC
  `);
}
