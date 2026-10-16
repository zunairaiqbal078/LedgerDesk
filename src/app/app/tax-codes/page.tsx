import { TaxCodesManager } from "@/components/tax-codes-manager";
import { prisma } from "@/lib/db";
import { hasMinOrgRole } from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";

export default async function TaxCodesPage() {
  const { organization, role } = await requireOrgContext("VIEWER");
  const taxCodes = await prisma.taxCode.findMany({
    where: { organizationId: organization.id },
    orderBy: { code: "asc" },
  });

  return (
    <TaxCodesManager
      canEdit={hasMinOrgRole(role, "ADMIN")}
      taxCodes={taxCodes.map((tax) => ({
        id: tax.id,
        code: tax.code,
        name: tax.name,
        rate: Number(tax.rate),
        kind: tax.kind,
        province: tax.province,
        isSystem: tax.isSystem,
      }))}
    />
  );
}
