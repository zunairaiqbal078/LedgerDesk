import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_CHART_ACCOUNTS,
  DEFAULT_RULES,
  DEFAULT_TAX_CODES,
} from "@/lib/canada-defaults.generated";

export { DEFAULT_CHART_ACCOUNTS, DEFAULT_RULES, DEFAULT_TAX_CODES };
export {
  isProvinceTaxKind,
  isSalesTaxKind,
  splitTaxCodesByKind,
  taxCategoryLabel,
} from "@/lib/tax-helpers";

export async function seedOrganizationDefaults(
  prisma: PrismaClient,
  organizationId: string,
) {
  await prisma.taxCode.createMany({
    data: DEFAULT_TAX_CODES.map((tax) => ({
      organizationId,
      code: tax.code,
      name: tax.name,
      rate: tax.rate,
      kind: tax.kind,
      province: tax.province,
      isSystem: true,
    })),
    skipDuplicates: true,
  });

  await prisma.rule.createMany({
    data: DEFAULT_RULES.map((rule) => ({
      organizationId,
      name: rule.name,
      descriptionMatch: rule.descriptionMatch,
      matchType: rule.matchType,
      appliesTo: rule.appliesTo,
      applyDeposit: rule.applyDeposit,
      applyWithdrawal: rule.applyWithdrawal,
      accountNumber: rule.accountNumber,
      accountName: rule.accountName,
      taxCodes: [...rule.taxCodes],
      provinceTaxCodes: [...rule.provinceTaxCodes],
      taxMode: rule.taxMode,
      active: rule.active,
      isBuiltIn: true,
    })),
  });

  await prisma.folder.create({
    data: {
      organizationId,
      name: "General",
    },
  });
}
