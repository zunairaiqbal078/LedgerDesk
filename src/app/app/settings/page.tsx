import {
  removeTeamMemberAction,
  updateTeamMemberRoleAction,
} from "@/app/actions/org";
import {
  CreateTeamMemberForm,
  PasswordForm,
  ProfileForm,
} from "@/components/settings-forms";
import { Badge, Button, Card, Select } from "@/components/ui";
import { prisma } from "@/lib/db";
import { canManageTeam } from "@/lib/permissions";
import { getFirmTeamAdminContext, requireOrgContext } from "@/lib/session";

export default async function SettingsPage() {
  const { session } = await requireOrgContext("VIEWER");
  const firmTeam = await getFirmTeamAdminContext(session.user.id);
  const showFirmTeam = Boolean(firmTeam);
  const manageFirmTeam = showFirmTeam && canManageTeam(firmTeam!.role);

  const members = showFirmTeam
    ? await prisma.membership.findMany({
        where: { organizationId: firmTeam!.firmOrganizationId },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          {showFirmTeam
            ? "Profile, password, and your accounting firm team."
            : "Manage your profile and password."}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 text-lg font-semibold">Profile</h2>
          <ProfileForm defaultName={session.user.name} />
        </Card>
        <Card className="p-6">
          <h2 className="mb-4 text-lg font-semibold">Change password</h2>
          <PasswordForm />
        </Card>
      </div>

      {showFirmTeam ? (
        <>
          {manageFirmTeam ? (
            <Card className="p-6">
              <h2 className="mb-1 text-lg font-semibold">Add team member</h2>
              <p className="mb-1 text-sm text-slate-500">
                Firm: <strong>{firmTeam!.firmName}</strong> — teammates can access all client books
                under this firm.
              </p>
              <p className="mb-4 text-sm text-slate-500">
                Set email + password yourself and share credentials with your teammate. No invite
                email is sent.
              </p>
              <CreateTeamMemberForm />
            </Card>
          ) : null}

          <Card className="overflow-hidden" id="team">
            <div className="border-b border-slate-100 px-6 py-4">
              <h2 className="text-lg font-semibold">Firm team members</h2>
              <p className="text-sm text-slate-500">{firmTeam!.firmName}</p>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  {manageFirmTeam ? <th className="px-4 py-3">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium">{member.user.name}</td>
                    <td className="px-4 py-3">{member.user.email}</td>
                    <td className="px-4 py-3">
                      {manageFirmTeam && member.role !== "OWNER" ? (
                        <form action={updateTeamMemberRoleAction} className="flex items-center gap-2">
                          <input type="hidden" name="memberId" value={member.id} />
                          <Select name="role" defaultValue={member.role} className="h-9 w-40">
                            <option value="ADMIN">Admin</option>
                            <option value="BOOKKEEPER">Bookkeeper</option>
                            <option value="VIEWER">Viewer</option>
                          </Select>
                          <Button type="submit" size="sm" variant="secondary">
                            Save
                          </Button>
                        </form>
                      ) : (
                        <Badge>{member.role}</Badge>
                      )}
                    </td>
                    {manageFirmTeam ? (
                      <td className="px-4 py-3">
                        {member.role !== "OWNER" && member.userId !== session.user.id ? (
                          <form action={removeTeamMemberAction}>
                            <input type="hidden" name="memberId" value={member.id} />
                            <Button type="submit" size="sm" variant="danger">
                              Remove
                            </Button>
                          </form>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : null}
    </div>
  );
}
