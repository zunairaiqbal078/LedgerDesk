import { createHash, timingSafeEqual } from "crypto";
import type { GlobalRole, OrgRole } from "@prisma/client";

export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  VIEWER: 1,
  BOOKKEEPER: 2,
  ADMIN: 3,
  OWNER: 4,
};

export function hasMinOrgRole(role: OrgRole, minimum: OrgRole) {
  return ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[minimum];
}

export function isSuperAdmin(globalRole: GlobalRole) {
  return globalRole === "SUPER_ADMIN";
}

export function canManageTeam(role: OrgRole) {
  return hasMinOrgRole(role, "ADMIN");
}

export function canManageBanks(role: OrgRole) {
  return hasMinOrgRole(role, "ADMIN");
}

export function canEditTransactions(role: OrgRole) {
  return hasMinOrgRole(role, "BOOKKEEPER");
}

export function canViewOnly(role: OrgRole) {
  return role === "VIEWER";
}

/** Platform owner — all organizations + license controls. */
export function canSeeLicensePanel(isSuperAdmin: boolean) {
  return isSuperAdmin;
}

/**
 * Client picker: firm staff / super admin, or a hired accountant with 2+ My Business books.
 * Solo My Business owners (1 org) do not see the switcher.
 */
export function canSeeClientWorkspace(
  isSuperAdmin: boolean,
  isFirmStaff: boolean,
  switchableClientCount = 0,
) {
  if (isSuperAdmin) return true;
  if (isFirmStaff) return true;
  return switchableClientCount > 1;
}

/** Constant-time compare for webhook signatures */
export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}
