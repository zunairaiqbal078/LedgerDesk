import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { GlobalRole, OrgRole } from "@prisma/client";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { isPrismaConnectionError } from "@/lib/db-errors";
import { prisma } from "@/lib/db";
import { findAccountantFirmMembershipForUser } from "@/lib/org-meta";
import { hasMinOrgRole, isSuperAdmin } from "@/lib/permissions";
import { resolveOrganizationAccess } from "@/lib/org-access";

/** Deduplicate session reads within a single RSC request (layout + panes). */
export const getSession = cache(async function getSession() {
  try {
    return await auth.api.getSession({
      headers: await headers(),
    });
  } catch (error) {
    if (isPrismaConnectionError(error)) {
      redirect("/db-unavailable");
    }
    if (error instanceof APIError) {
      return null;
    }
    console.error("[auth] getSession failed:", error);
    return null;
  }
});

export async function requireSession() {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login?error=session");
  }
  if ((session.user as { banned?: boolean }).banned) {
    redirect("/login?error=banned");
  }
  return session;
}

export async function requireSuperAdmin() {
  const session = await requireSession();
  const globalRole = (session.user as { globalRole?: string }).globalRole;
  if (!isSuperAdmin((globalRole as GlobalRole) ?? "USER")) {
    redirect("/app");
  }
  return session;
}

export const getMembershipContext = cache(async function getMembershipContext(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { globalRole: true },
  });
  const globalRole = (user?.globalRole ?? "USER") as GlobalRole;

  const preference = await prisma.userPreference.findUnique({
    where: { userId },
    include: {
      activeBankAccount: true,
    },
  });

  let organizationId = preference?.activeOrganizationId ?? null;

  if (!organizationId) {
    const firstMembership = await prisma.membership.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    organizationId = firstMembership?.organizationId ?? null;

    if (organizationId) {
      await prisma.userPreference.upsert({
        where: { userId },
        create: {
          userId,
          activeOrganizationId: organizationId,
        },
        update: {
          activeOrganizationId: organizationId,
        },
      });
    }
  }

  if (!organizationId) {
    return null;
  }

  const { getFirstActiveClientIdUnderFirm, getOrganizationKind } = await import(
    "@/lib/org-meta"
  );
  const activeKind = await getOrganizationKind(organizationId);
  if (activeKind === "ACCOUNTANT_FIRM") {
    const firstClientId = await getFirstActiveClientIdUnderFirm(organizationId);
    if (firstClientId) {
      organizationId = firstClientId;
      await prisma.userPreference.upsert({
        where: { userId },
        create: {
          userId,
          activeOrganizationId: organizationId,
          activeBankAccountId: null,
        },
        update: {
          activeOrganizationId: organizationId,
          activeBankAccountId: null,
        },
      });
    }
  }

  const resolved = await resolveOrganizationAccess(userId, organizationId, globalRole);
  if (!resolved) return null;

  let activeBankId = preference?.activeBankAccountId ?? null;
  const banks = resolved.organization.banks;
  if (activeBankId && !banks.some((b) => b.id === activeBankId)) {
    activeBankId = null;
  }
  if (!activeBankId && banks[0]) {
    activeBankId = banks[0].id;
    await prisma.userPreference.upsert({
      where: { userId },
      create: {
        userId,
        activeOrganizationId: organizationId,
        activeBankAccountId: activeBankId,
      },
      update: {
        activeBankAccountId: activeBankId,
      },
    });
  }

  const membership =
    (await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    })) ?? null;

  return {
    membership,
    organization: resolved.organization,
    role: resolved.role as OrgRole,
    viaFirm: resolved.viaFirm,
    banks,
    activeBankId,
    activeBank: banks.find((b) => b.id === activeBankId) ?? null,
  };
});

/** Firm-level team (admin+ on ACCOUNTANT_FIRM). Not used for solo client orgs. */
export async function getFirmTeamAdminContext(userId: string) {
  const firm = await findAccountantFirmMembershipForUser(userId);
  if (!firm || !hasMinOrgRole(firm.role, "ADMIN")) {
    return null;
  }
  return {
    firmOrganizationId: firm.organizationId,
    firmName: firm.orgName,
    role: firm.role as OrgRole,
  };
}

export async function requireOrgContext(minimumRole: OrgRole = "VIEWER") {
  const session = await requireSession();
  const context = await getMembershipContext(session.user.id);

  if (!context) {
    redirect("/onboarding");
  }

  if (!hasMinOrgRole(context.role, minimumRole)) {
    redirect("/app?error=forbidden");
  }

  const { ensureOrganizationDefaultsCached } = await import("@/lib/ensure-org-defaults");
  await ensureOrganizationDefaultsCached(context.organization.id);

  return { session, ...context };
}
