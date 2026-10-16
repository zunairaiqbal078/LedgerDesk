import { BanksManager } from "@/components/banks-manager";
import { requireOrgContext } from "@/lib/session";
import { canManageBanks } from "@/lib/permissions";

export default async function BanksPage() {
  const { banks, activeBankId, role } = await requireOrgContext("VIEWER");

  return (
    <BanksManager
      canManage={canManageBanks(role)}
      activeBankId={activeBankId}
      banks={banks.map((bank) => ({
        id: bank.id,
        name: bank.name,
        type: bank.type,
        mask: bank.mask,
        currency: bank.currency,
      }))}
    />
  );
}
