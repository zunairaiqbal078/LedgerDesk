"use server";

import { hashPassword } from "better-auth/crypto";
import { APIError } from "better-auth/api";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { seedOrganizationDefaults } from "@/lib/org-defaults";
import { userCanAccessOrganization } from "@/lib/org-access";
import { canManageTeam, hasMinOrgRole, isSuperAdmin } from "@/lib/permissions";
import {
  getFirmTeamAdminContext,
  requireOrgContext,
  requireSession,
  requireSuperAdmin,
} from "@/lib/session";
import { normalizeProvince } from "@/lib/canada-provinces";
import { filingFrequencyFromHtml } from "@/lib/province-tax-profile";
import { slugify } from "@/lib/utils";

const signupAccountSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(10).max(128),
});

const signupFirmSchema = signupAccountSchema.extend({
  firmName: z.string().min(2).max(120),
});

const signupClientSchema = signupAccountSchema.extend({
  businessName: z.string().min(2).max(120),
});

export type ActionResult = {
  ok: boolean;
  error?: string;
  message?: string;
  count?: number;
};

async function registerUserAndOrganization(input: {
  orgName: string;
  slugBase: string;
  kind: "ACCOUNTANT_FIRM" | "CLIENT";
  firmOrganizationId?: string | null;
  name: string;
  email: string;
  password: string;
  auditMetadata: Record<string, string>;
}) {
  const baseSlug = slugify(input.slugBase) || "org";
  let slug = baseSlug;
  let attempt = 1;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  const result = await auth.api.signUpEmail({
    body: { name: input.name, email: input.email, password: input.password },
  });

  if (!result?.user) {
    return { ok: false as const, error: "Could not create account." };
  }

  const organization = await prisma.organization.create({
    data: {
      name: input.orgName,
      slug,
      kind: input.kind,
      firmOrganizationId: input.firmOrganizationId ?? null,
      members: {
        create: {
          userId: result.user.id,
          role: "OWNER",
        },
      },
    },
  });

  await seedOrganizationDefaults(prisma, organization.id);

  await prisma.userPreference.upsert({
    where: { userId: result.user.id },
    create: {
      userId: result.user.id,
      activeOrganizationId: organization.id,
    },
    update: {
      activeOrganizationId: organization.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      actorId: result.user.id,
      action: "organization.created",
      entityType: "Organization",
      entityId: organization.id,
      metadata: input.auditMetadata,
    },
  });

  return {
    ok: true as const,
    userId: result.user.id,
    organizationId: organization.id,
  };
}

/** Extra solo CLIENT company owned by an existing My Business user (no firm parent). */
async function createSoloClientCompanyForUser(input: {
  userId: string;
  companyName: string;
  setActive?: boolean;
  auditAction?: string;
}) {
  const baseSlug = slugify(input.companyName) || "company";
  let slug = baseSlug;
  let attempt = 1;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  const organization = await prisma.organization.create({
    data: {
      name: input.companyName,
      slug,
      kind: "CLIENT",
      firmOrganizationId: null,
      members: {
        create: {
          userId: input.userId,
          role: "OWNER",
        },
      },
    },
  });

  await seedOrganizationDefaults(prisma, organization.id);

  if (input.setActive !== false) {
    await prisma.userPreference.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        activeOrganizationId: organization.id,
      },
      update: {
        activeOrganizationId: organization.id,
        activeBankAccountId: null,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      actorId: input.userId,
      action: input.auditAction ?? "company.created",
      entityType: "Organization",
      entityId: organization.id,
      metadata: { companyName: input.companyName, accountType: "client" },
    },
  });

  return organization;
}

async function userOwnsSoloMyBusiness(userId: string) {
  return prisma.membership.findFirst({
    where: {
      userId,
      role: "OWNER",
      organization: {
        kind: "CLIENT",
        firmOrganizationId: null,
      },
    },
    select: { id: true },
  });
}

function signupErrorResult(error: unknown): ActionResult {
  if (error instanceof APIError) {
    return { ok: false, error: error.message || "Signup failed." };
  }
  const message = error instanceof Error ? error.message : "Signup failed.";
  if (message.toLowerCase().includes("already") || message.toLowerCase().includes("unique")) {
    return { ok: false, error: "An account with this email already exists." };
  }
  return { ok: false, error: message };
}

export async function signupAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const accountType = String(formData.get("accountType") ?? "firm");
  if (accountType === "client") {
    return signupClientAction(_prev, formData);
  }
  return signupFirmAction(_prev, formData);
}

export async function signupFirmAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = signupFirmSchema.safeParse({
    firmName: formData.get("firmName"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { ok: false, error: "Please provide valid firm and account details." };
  }

  const { firmName, name, email, password } = parsed.data;

  try {
    const result = await registerUserAndOrganization({
      orgName: firmName,
      slugBase: firmName,
      kind: "ACCOUNTANT_FIRM",
      name,
      email,
      password,
      auditMetadata: { firmName, accountType: "firm" },
    });
    if (!result.ok) return result;
  } catch (error) {
    return signupErrorResult(error);
  }

  redirect("/app");
}

export async function signupClientAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = signupClientSchema.safeParse({
    businessName: formData.get("businessName"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { ok: false, error: "Please provide valid business and account details." };
  }

  const { businessName, name, email, password } = parsed.data;
  const extraNames = formData
    .getAll("additionalCompany")
    .map((v) => String(v).trim())
    .filter((v) => v.length >= 2)
    .filter((v) => v.toLowerCase() !== businessName.toLowerCase());

  try {
    const result = await registerUserAndOrganization({
      orgName: businessName,
      slugBase: businessName,
      kind: "CLIENT",
      name,
      email,
      password,
      auditMetadata: { businessName, accountType: "client" },
    });
    if (!result.ok) return result;

    for (const companyName of extraNames) {
      await createSoloClientCompanyForUser({
        userId: result.userId,
        companyName,
        setActive: false,
        auditAction: "company.created_at_signup",
      });
    }
  } catch (error) {
    return signupErrorResult(error);
  }

  redirect("/app");
}

const myBusinessCompanySchema = z.object({
  name: z.string().min(2).max(120),
  province: z.string().max(8).optional(),
});

/** My Business owner — add another isolated company under the same login. */
export async function createMyBusinessCompanyAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const owns = await userOwnsSoloMyBusiness(session.user.id);
  if (!owns) {
    return {
      ok: false,
      error: "Only a My Business owner can add another company.",
    };
  }

  const parsed = myBusinessCompanySchema.safeParse({
    name: formData.get("name"),
    province: String(formData.get("province") ?? "").trim() || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: "Please enter a valid company name." };
  }

  const provinceRaw = parsed.data.province ? normalizeProvince(parsed.data.province) : "";

  const organization = await createSoloClientCompanyForUser({
    userId: session.user.id,
    companyName: parsed.data.name,
    setActive: true,
  });

  if (provinceRaw) {
    await prisma.organization.update({
      where: { id: organization.id },
      data: { defaultProvince: provinceRaw },
    });
  }

  revalidatePath("/app");
  return {
    ok: true,
    message: `Company “${parsed.data.name}” created. Books stay separate from your other companies. Hire accountants per company in Settings.`,
  };
}

const teamMemberSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(10).max(128),
  role: z.enum(["ADMIN", "BOOKKEEPER", "VIEWER"]),
});

export async function createTeamMemberAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const firmTeam = await getFirmTeamAdminContext(session.user.id);
  if (!firmTeam || !canManageTeam(firmTeam.role)) {
    return {
      ok: false,
      error: "Team members can only be added on an accounting firm account.",
    };
  }
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: firmTeam.firmOrganizationId },
  });

  const parsed = teamMemberSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { ok: false, error: "Invalid team member details." };
  }

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });

  if (existing) {
    const alreadyMember = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: existing.id,
        },
      },
    });
    if (alreadyMember) {
      return { ok: false, error: "This user is already on your team." };
    }
    return {
      ok: false,
      error: "This email is already registered. Use a unique email for the team member.",
    };
  }

  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      emailVerified: true,
      globalRole: "USER",
    },
  });

  const hashed = await hashPassword(parsed.data.password);
  await prisma.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: hashed,
    },
  });

  await prisma.membership.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      role: parsed.data.role,
      createdById: session.user.id,
    },
  });

  await prisma.userPreference.create({
    data: {
      userId: user.id,
      activeOrganizationId: organization.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      actorId: session.user.id,
      action: "team_member.created",
      entityType: "User",
      entityId: user.id,
      metadata: { email: user.email, role: parsed.data.role },
    },
  });

  return { ok: true };
}

export async function updateTeamMemberRoleAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const firmTeam = await getFirmTeamAdminContext(session.user.id);
  if (!firmTeam) return;

  const memberId = String(formData.get("memberId") ?? "");
  const nextRole = String(formData.get("role") ?? "") as "ADMIN" | "BOOKKEEPER" | "VIEWER" | "OWNER";

  if (!["ADMIN", "BOOKKEEPER", "VIEWER"].includes(nextRole)) {
    return;
  }

  const membership = await prisma.membership.findFirst({
    where: { id: memberId, organizationId: firmTeam.firmOrganizationId },
  });

  if (!membership) return;
  if (membership.role === "OWNER") return;
  if (membership.userId === session.user.id) return;
  if (!hasMinOrgRole(firmTeam.role, "ADMIN")) return;

  await prisma.membership.update({
    where: { id: membership.id },
    data: { role: nextRole },
  });
}

export async function removeTeamMemberAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const firmTeam = await getFirmTeamAdminContext(session.user.id);
  if (!firmTeam) return;

  const memberId = String(formData.get("memberId") ?? "");

  const membership = await prisma.membership.findFirst({
    where: { id: memberId, organizationId: firmTeam.firmOrganizationId },
  });

  if (!membership) return;
  if (membership.role === "OWNER") return;
  if (membership.userId === session.user.id) return;

  await prisma.membership.delete({ where: { id: membership.id } });
  await prisma.auditLog.create({
    data: {
      organizationId: firmTeam.firmOrganizationId,
      actorId: session.user.id,
      action: "team_member.removed",
      entityType: "Membership",
      entityId: membership.id,
    },
  });
}

const hireAccountantSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().max(128).optional(),
  role: z.enum(["ADMIN", "BOOKKEEPER", "VIEWER"]).default("BOOKKEEPER"),
});

/** My Business (solo CLIENT) only — create or link an accountant membership. */
export async function hireAccountantAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { session, organization, role } = await requireOrgContext("ADMIN");
  if (organization.kind !== "CLIENT" || organization.firmOrganizationId) {
    return {
      ok: false,
      error: "Hire accountant is only available on a My Business (individual) account.",
    };
  }
  if (!canManageTeam(role)) {
    return { ok: false, error: "Only the business owner/admin can hire an accountant." };
  }

  const rawPassword = String(formData.get("password") ?? "").trim();
  const parsed = hireAccountantSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: rawPassword || undefined,
    role: formData.get("role") || "BOOKKEEPER",
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid accountant details." };
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    const alreadyMember = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: existing.id,
        },
      },
    });
    if (alreadyMember) {
      return { ok: false, error: "This accountant is already linked to your business." };
    }

    await prisma.membership.create({
      data: {
        organizationId: organization.id,
        userId: existing.id,
        role: parsed.data.role,
        createdById: session.user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: organization.id,
        actorId: session.user.id,
        action: "accountant.hired",
        entityType: "User",
        entityId: existing.id,
        metadata: { email, role: parsed.data.role, linkedExisting: true },
      },
    });

    revalidatePath("/app/settings");
    revalidatePath("/app");
    return {
      ok: true,
      message: `Linked existing accountant ${email}. They sign in with their current password. If they manage multiple businesses, they can switch in the sidebar.`,
    };
  }

  if (!parsed.data.password || parsed.data.password.length < 10) {
    return {
      ok: false,
      error: "Password is required for a new accountant (min 10 characters).",
    };
  }

  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email,
      emailVerified: true,
      globalRole: "USER",
    },
  });

  const hashed = await hashPassword(parsed.data.password);
  await prisma.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: hashed,
    },
  });

  await prisma.membership.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      role: parsed.data.role,
      createdById: session.user.id,
    },
  });

  await prisma.userPreference.create({
    data: {
      userId: user.id,
      activeOrganizationId: organization.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      actorId: session.user.id,
      action: "accountant.hired",
      entityType: "User",
      entityId: user.id,
      metadata: { email, role: parsed.data.role, linkedExisting: false },
    },
  });

  revalidatePath("/app/settings");
  return {
    ok: true,
    message: `Accountant created. Share ${email} and the password you set — they can sign in at Login.`,
  };
}

export async function updateHiredAccountantRoleAction(formData: FormData): Promise<void> {
  const { session, organization, role } = await requireOrgContext("ADMIN");
  if (organization.kind !== "CLIENT" || organization.firmOrganizationId) return;
  if (!canManageTeam(role)) return;

  const memberId = String(formData.get("memberId") ?? "");
  const nextRole = String(formData.get("role") ?? "") as "ADMIN" | "BOOKKEEPER" | "VIEWER";
  if (!["ADMIN", "BOOKKEEPER", "VIEWER"].includes(nextRole)) return;

  const membership = await prisma.membership.findFirst({
    where: { id: memberId, organizationId: organization.id },
  });
  if (!membership || membership.role === "OWNER") return;
  if (membership.userId === session.user.id) return;

  await prisma.membership.update({
    where: { id: membership.id },
    data: { role: nextRole },
  });
  revalidatePath("/app/settings");
}

export async function removeHiredAccountantAction(formData: FormData): Promise<void> {
  const { session, organization, role } = await requireOrgContext("ADMIN");
  if (organization.kind !== "CLIENT" || organization.firmOrganizationId) return;
  if (!canManageTeam(role)) return;

  const memberId = String(formData.get("memberId") ?? "");
  const membership = await prisma.membership.findFirst({
    where: { id: memberId, organizationId: organization.id },
  });
  if (!membership || membership.role === "OWNER") return;
  if (membership.userId === session.user.id) return;

  await prisma.membership.delete({ where: { id: membership.id } });
  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      actorId: session.user.id,
      action: "accountant.removed",
      entityType: "Membership",
      entityId: membership.id,
    },
  });
  revalidatePath("/app/settings");
}

const bankSchema = z.object({
  name: z.string().min(2).max(120),
  type: z.enum(["BANK", "CREDIT_CARD"]),
  mask: z.string().max(8).optional(),
  currency: z.string().min(3).max(3).default("CAD"),
  institutionName: z.string().max(120).optional(),
});

export async function createBankAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { session, organization } = await requireOrgContext("ADMIN");
  const parsed = bankSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    mask: formData.get("mask") || undefined,
    currency: formData.get("currency") || "CAD",
    institutionName: formData.get("institutionName") || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: "Invalid bank details." };
  }

  const bank = await prisma.bankAccount.create({
    data: {
      organizationId: organization.id,
      name: parsed.data.name,
      type: parsed.data.type,
      mask: parsed.data.mask,
      currency: parsed.data.currency.toUpperCase(),
      institutionName: parsed.data.institutionName,
    },
  });

  await prisma.userPreference.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      activeOrganizationId: organization.id,
      activeBankAccountId: bank.id,
    },
    update: {
      activeBankAccountId: bank.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      actorId: session.user.id,
      action: "bank.created",
      entityType: "BankAccount",
      entityId: bank.id,
      metadata: { name: bank.name, type: bank.type },
    },
  });

  return { ok: true };
}

export async function deleteBankAction(formData: FormData): Promise<ActionResult> {
  const { session, organization } = await requireOrgContext("ADMIN");
  const id = String(formData.get("id") ?? "");
  const bank = await prisma.bankAccount.findFirst({
    where: { id, organizationId: organization.id },
  });
  if (!bank) return { ok: false, error: "Bank not found." };

  const txCount = await prisma.transaction.count({
    where: { bankAccountId: bank.id, organizationId: organization.id },
  });

  await prisma.bankAccount.delete({ where: { id: bank.id } });

  // Clear active bank preference if it pointed here
  await prisma.userPreference.updateMany({
    where: {
      activeOrganizationId: organization.id,
      activeBankAccountId: bank.id,
    },
    data: { activeBankAccountId: null },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      actorId: session.user.id,
      action: "bank.deleted",
      entityType: "BankAccount",
      entityId: bank.id,
      metadata: { name: bank.name, transactionsDeleted: txCount },
    },
  });

  revalidatePath("/app");
  return {
    ok: true,
    message: `Deleted bank “${bank.name}”${txCount ? ` and ${txCount} transactions` : ""}.`,
  };
}

export async function bulkDeleteBanksAction(formData: FormData): Promise<ActionResult> {
  const { session, organization } = await requireOrgContext("ADMIN");
  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!ids.length) return { ok: false, error: "Select banks first." };

  const banks = await prisma.bankAccount.findMany({
    where: { id: { in: ids }, organizationId: organization.id },
    select: { id: true, name: true },
  });
  if (!banks.length) return { ok: false, error: "No matching banks." };

  const bankIds = banks.map((b) => b.id);
  const txCount = await prisma.transaction.count({
    where: { bankAccountId: { in: bankIds }, organizationId: organization.id },
  });

  await prisma.bankAccount.deleteMany({
    where: { id: { in: bankIds }, organizationId: organization.id },
  });
  await prisma.userPreference.updateMany({
    where: {
      activeOrganizationId: organization.id,
      activeBankAccountId: { in: bankIds },
    },
    data: { activeBankAccountId: null },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      actorId: session.user.id,
      action: "banks.bulk_deleted",
      entityType: "BankAccount",
      metadata: { count: banks.length, transactionsDeleted: txCount },
    },
  });

  revalidatePath("/app");
  return {
    ok: true,
    count: banks.length,
    message: `Deleted ${banks.length} bank(s)${txCount ? ` and ${txCount} transactions` : ""}.`,
  };
}

export async function setActiveBankAction(formData: FormData) {
  const session = await requireSession();
  const bankId = String(formData.get("bankId") ?? "");
  const context = await requireOrgContext("VIEWER");

  const bank = await prisma.bankAccount.findFirst({
    where: {
      id: bankId,
      organizationId: context.organization.id,
      isArchived: false,
    },
  });

  if (!bank) {
    redirect("/app?error=invalid-bank");
  }

  await prisma.userPreference.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      activeOrganizationId: context.organization.id,
      activeBankAccountId: bank.id,
    },
    update: {
      activeBankAccountId: bank.id,
    },
  });

  redirect("/app");
}

const profileSchema = z.object({
  name: z.string().min(2).max(120),
});

export async function updateProfileAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = profileSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { ok: false, error: "Invalid name." };

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name: parsed.data.name },
  });

  return { ok: true };
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(10).max(128),
    confirmPassword: z.string().min(10).max(128),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export async function changePasswordAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid password." };
  }

  try {
    await auth.api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
      },
      headers: await headers(),
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not change password.";
    return { ok: false, error: message };
  }
}

export async function switchActiveOrganizationAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const organizationId = String(formData.get("organizationId") ?? "");
  if (!organizationId) return;

  const globalRole = (session.user as { globalRole?: string }).globalRole ?? "USER";
  const allowed = await userCanAccessOrganization(
    session.user.id,
    organizationId,
    globalRole as "SUPER_ADMIN" | "USER",
  );
  if (!allowed) return;

  await prisma.userPreference.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, activeOrganizationId: organizationId },
    update: { activeOrganizationId: organizationId, activeBankAccountId: null },
  });

  revalidatePath("/app");
  redirect("/app");
}

const clientOrgSchema = z.object({
  name: z.string().min(2).max(120),
  province: z.string().max(8).optional(),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).default(1),
  fiscalYearStartDay: z.coerce.number().int().min(1).max(31).default(1),
  gstYearStartMonth: z.coerce.number().int().min(1).max(12).default(1),
  gstYearStartDay: z.coerce.number().int().min(1).max(31).default(1),
  gstFilingFrequency: z.string().default("Quarterly"),
  pstFilingFrequency: z.string().default("Quarterly"),
});

function parseGstPeriodsJson(raw: string) {
  try {
    const parsed = JSON.parse(raw) as Array<{ name?: string; startDate?: string; endDate?: string }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p.name?.trim() && p.startDate && p.endDate)
      .map((p) => ({
        name: String(p.name).trim(),
        startDate: new Date(p.startDate!),
        endDate: new Date(p.endDate!),
      }))
      .filter((p) => !Number.isNaN(p.startDate.getTime()) && !Number.isNaN(p.endDate.getTime()));
  } catch {
    return [];
  }
}

export async function createClientOrganizationAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { session, organization } = await requireOrgContext("ADMIN");

  let firmOrganizationId: string;
  if (organization.kind === "ACCOUNTANT_FIRM") {
    firmOrganizationId = organization.id;
  } else if (organization.firmOrganizationId) {
    const firmMembership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: organization.firmOrganizationId,
          userId: session.user.id,
        },
      },
    });
    if (!firmMembership || !hasMinOrgRole(firmMembership.role, "ADMIN")) {
      return { ok: false, error: "You cannot add clients from this workspace." };
    }
    firmOrganizationId = organization.firmOrganizationId;
  } else {
    return { ok: false, error: "Only accounting firms can add client books." };
  }

  const parsed = clientOrgSchema.safeParse({
    name: formData.get("name"),
    province: String(formData.get("province") ?? "").trim() || undefined,
    fiscalYearStartMonth: formData.get("fiscalYearStartMonth"),
    fiscalYearStartDay: formData.get("fiscalYearStartDay"),
    gstYearStartMonth: formData.get("gstYearStartMonth"),
    gstYearStartDay: formData.get("gstYearStartDay"),
    gstFilingFrequency: formData.get("gstFilingFrequency"),
    pstFilingFrequency: formData.get("pstFilingFrequency"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Please enter a valid client name and settings." };
  }

  const provinceRaw = parsed.data.province ? normalizeProvince(parsed.data.province) : "";
  const gstPeriods = parseGstPeriodsJson(String(formData.get("gstPeriodsJson") ?? "[]"));

  const baseSlug = slugify(parsed.data.name) || "client";
  let slug = baseSlug;
  let attempt = 1;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  const client = await prisma.organization.create({
    data: {
      name: parsed.data.name,
      slug,
      kind: "CLIENT",
      firmOrganizationId,
      defaultProvince: provinceRaw || null,
      fiscalYearStartMonth: parsed.data.fiscalYearStartMonth,
      fiscalYearStartDay: parsed.data.fiscalYearStartDay,
      gstYearStartMonth: parsed.data.gstYearStartMonth,
      gstYearStartDay: parsed.data.gstYearStartDay,
      gstFilingFrequency: filingFrequencyFromHtml(parsed.data.gstFilingFrequency),
      pstFilingFrequency: filingFrequencyFromHtml(parsed.data.pstFilingFrequency),
      gstPeriods: gstPeriods.length
        ? {
            create: gstPeriods.map((p) => ({
              name: p.name,
              startDate: p.startDate,
              endDate: p.endDate,
            })),
          }
        : undefined,
    },
  });

  await seedOrganizationDefaults(prisma, client.id);
  await prisma.userPreference.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      activeOrganizationId: client.id,
    },
    update: {
      activeOrganizationId: client.id,
      activeBankAccountId: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: firmOrganizationId,
      actorId: session.user.id,
      action: "client.created",
      entityType: "Organization",
      entityId: client.id,
      metadata: { name: client.name, province: provinceRaw || null },
    },
  });

  revalidatePath("/app");
  return {
    ok: true,
    message: `Client “${client.name}” created${provinceRaw ? ` (${provinceRaw})` : ""}.`,
  };
}

export async function adminToggleOrgAction(formData: FormData) {
  await requireSuperAdmin();
  const organizationId = String(formData.get("organizationId") ?? "");
  const isActive = String(formData.get("isActive") ?? "") === "true";

  await prisma.organization.update({
    where: { id: organizationId },
    data: { isActive },
  });

  redirect("/admin");
}
