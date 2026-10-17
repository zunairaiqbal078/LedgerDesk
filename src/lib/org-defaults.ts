import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_CHART_ACCOUNTS,
  DEFAULT_RULES,
  DEFAULT_TAX_CODES,
} from "@/lib/canada-defaults.generated";

export { DEFAULT_CHART_ACCOUNTS, DEFAULT_RULES, DEFAULT_TAX_CODES };
// DEFAULT_RULES kept in re-export for “Add predefined rules” UI / fill helper.
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

  // Predefined rules are opt-in via “Add predefined rules” (per client), like starter accounts.

  await prisma.folder.create({
    data: {
      organizationId,
      name: "General",
    },
  });
}
