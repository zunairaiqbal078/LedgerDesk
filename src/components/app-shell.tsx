"use client";

import { usePathname } from "next/navigation";
import { ConverterSidebar } from "@/components/converter/converter-sidebar";
import { ConverterTopbar } from "@/components/converter/converter-topbar";
import type { OrganizationKind, OrgRole } from "@prisma/client";

type Bank = {
  id: string;
  name: string;
  type: "BANK" | "CREDIT_CARD";
  mask: string | null;
};

type Folder = { id: string; name: string };

type UserOrganization = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  role: string;
};

export function AppShell({
  children,
  orgName,
  accountantFirmName,
  activeOrgKind,
  userName,
  role,
  isSuperAdmin,
  isFirmStaff,
  canManageClients,
  canManageMyCompanies = false,
  activeOrganizationId,
  userOrganizations,
  orgRole,
  banks,
  activeBankId,
  folders,
}: {
  children: React.ReactNode;
  orgName: string;
  accountantFirmName: string | null;
  activeOrgKind: OrganizationKind;
  userName: string;
  role: string;
  isSuperAdmin: boolean;
  isFirmStaff: boolean;
  canManageClients: boolean;
  canManageMyCompanies?: boolean;
  canManageFirmTeam?: boolean;
  activeOrganizationId: string;
  userOrganizations: UserOrganization[];
  orgRole: OrgRole;
  banks: Bank[];
  activeBankId: string | null;
  folders: Folder[];
}) {
  const pathname = usePathname();
  const isConverterHome = pathname === "/app";

  return (
    <div className="converter-app">
      <ConverterTopbar />
      <div className="layout">
        <aside className="sidebar-panel sidebar">
          <ConverterSidebar
            orgName={orgName}
            accountantFirmName={accountantFirmName}
            activeOrgKind={activeOrgKind}
            userName={userName}
            role={role}
            isSuperAdmin={isSuperAdmin}
            isFirmStaff={isFirmStaff}
            canManageClients={canManageClients}
            canManageMyCompanies={canManageMyCompanies}
            canManageFirmTeam={canManageClients}
            activeOrganizationId={activeOrganizationId}
            userOrganizations={userOrganizations}
            orgRole={orgRole}
            banks={banks}
            activeBankId={activeBankId}
            folders={folders}
          />
        </aside>
        <main className="main min-w-0">
          {isConverterHome ? children : <div className="panel">{children}</div>}
        </main>
      </div>
    </div>
  );
}
