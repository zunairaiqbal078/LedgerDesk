import { prisma } from "@/lib/db";
import { setOrganizationStarterRulesVisible } from "@/lib/org-meta";

/** Hide predefined rules in the list when none remain (after bulk/single delete). */
export async function syncStarterRulesVisibility(organizationId: string): Promise<void> {
  const remaining = await prisma.rule.count({
    where: { organizationId, isBuiltIn: true },
  });
  if (remaining === 0) {
    await setOrganizationStarterRulesVisible(organizationId, false);
  }
}
