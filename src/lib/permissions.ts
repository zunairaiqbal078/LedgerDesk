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
 * Client picker for accounting-firm staff / super admin — not for a single end-client user.
 */
export function canSeeClientWorkspace(
  isSuperAdmin: boolean,
  isFirmStaff: boolean,
) {
  if (isSuperAdmin) return true;
  return isFirmStaff;
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
