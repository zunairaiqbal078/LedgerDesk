import { prisma } from "@/lib/db";
import { setOrganizationStarterChartVisible } from "@/lib/org-meta";

/** Hide starter COA in the accounts list when none remain (after bulk/single delete). */
export async function syncStarterChartVisibility(organizationId: string): Promise<void> {
  const remaining = await prisma.chartAccount.count({
    where: { organizationId, isSystem: true },
  });
  if (remaining === 0) {
    await setOrganizationStarterChartVisible(organizationId, false);
  }
}
