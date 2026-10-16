import { RulesManager } from "@/components/rules-manager";
import { prisma } from "@/lib/db";
import { hasMinOrgRole } from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";

export default async function RulesPage() {
  const { organization, role } = await requireOrgContext("VIEWER");

  const [rules, accounts, taxCodes] = await Promise.all([
    prisma.rule.findMany({
      where: { organizationId: organization.id },
      orderBy: [{ isBuiltIn: "desc" }, { name: "asc" }],
    }),
    prisma.chartAccount.findMany({
      where: { organizationId: organization.id },
      orderBy: { number: "asc" },
    }),
    prisma.taxCode.findMany({
      where: { organizationId: organization.id },
      orderBy: { code: "asc" },
    }),
  ]);

  return (
    <RulesManager
      canEdit={hasMinOrgRole(role, "BOOKKEEPER")}
      accounts={accounts.map((a) => ({ number: a.number, name: a.name }))}
      taxCodes={taxCodes.map((t) => ({ code: t.code, name: t.name, kind: t.kind }))}
      rules={rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        descriptionMatch: rule.descriptionMatch,
        matchType: rule.matchType,
        appliesTo: rule.appliesTo,
        applyDeposit: rule.applyDeposit,
        applyWithdrawal: rule.applyWithdrawal,
        accountNumber: rule.accountNumber,
        accountName: rule.accountName,
        taxCodes: rule.taxCodes,
        provinceTaxCodes: rule.provinceTaxCodes,
        taxMode: rule.taxMode,
        active: rule.active,
        isBuiltIn: rule.isBuiltIn,
        learned: rule.learned,
      }))}
    />
  );
}
