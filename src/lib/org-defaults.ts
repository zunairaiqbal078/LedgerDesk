import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_CHART_ACCOUNTS,
  DEFAULT_RULES,
  DEFAULT_TAX_CODES,
} from "@/lib/canada-defaults.generated";

/** Opt-in starter row so “None” is a real category when editing transactions. */
export const NONE_CHART_ACCOUNT = {
  number: "0",
  name: "None",
  type: "EXPENSE" as const,
  defaultGstCode: null,
  defaultPstCode: null,
} as const;

/** Predefined small-business chart plus the None row (seed / preview). */
export const STARTER_CHART_ACCOUNTS = [NONE_CHART_ACCOUNT, ...DEFAULT_CHART_ACCOUNTS];

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
