import { AccountsManager } from "@/components/accounts-manager";
import { prisma } from "@/lib/db";
import { getOrganizationStarterChartVisible } from "@/lib/org-meta";
import { DEFAULT_CHART_ACCOUNTS } from "@/lib/org-defaults";
import { hasMinOrgRole } from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";

export default async function AccountsPage() {
  const { organization, role } = await requireOrgContext("VIEWER");
  const starterChartVisible = await getOrganizationStarterChartVisible(organization.id);
  const [accounts, taxCodes] = await Promise.all([
    prisma.chartAccount.findMany({
      where: {
        organizationId: organization.id,
        ...(starterChartVisible ? {} : { isSystem: false }),
      },
      orderBy: { number: "asc" },
    }),
    prisma.taxCode.findMany({
      where: { organizationId: organization.id },
      orderBy: { code: "asc" },
    }),
  ]);

  return (
    <AccountsManager
      canEdit={hasMinOrgRole(role, "ADMIN")}
      taxCodes={taxCodes.map((t) => ({ code: t.code, name: t.name, kind: t.kind }))}
      accounts={accounts.map((account) => ({
        id: account.id,
        number: account.number,
        name: account.name,
        type: account.type,
        defaultGstCode: account.defaultGstCode,
        defaultPstCode: account.defaultPstCode,
        isSystem: account.isSystem,
      }))}
      starterChartVisible={starterChartVisible}
      starterAccounts={DEFAULT_CHART_ACCOUNTS.map((a) => ({
        number: a.number,
        name: a.name,
        type: a.type,
      }))}
    />
  );
}
