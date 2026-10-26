"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { canEditTransactions, hasMinOrgRole } from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";

export type ActionResult = {
  ok: boolean;
  error?: string;
  message?: string;
  count?: number;
};

const ruleSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(160),
  descriptionMatch: z.string().min(1).max(2000),
  matchType: z.enum(["CONTAINS", "STARTS", "EXACT", "REGEX"]),
  appliesTo: z.enum(["BOTH", "BANK", "CREDIT_CARD"]),
  applyDeposit: z.coerce.boolean().default(true),
  applyWithdrawal: z.coerce.boolean().default(true),
  accountNumber: z.string().max(40).optional().nullable(),
  accountName: z.string().max(160).optional().nullable(),
  taxCodes: z.string().optional(),
  provinceTaxCodes: z.string().optional(),
  taxMode: z.enum(["INCLUSIVE", "EXCLUSIVE", "KEEP"]),
  active: z.coerce.boolean().default(true),
});

function parseTaxCodes(raw?: string | null) {
  if (!raw) return [] as string[];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function formBool(formData: FormData, key: string) {
  const value = formData.get(key);
  return value === "on" || value === "true" || value === "1";
}

export async function saveRuleAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { organization, role, session } = await requireOrgContext("BOOKKEEPER");
  if (!hasMinOrgRole(role, "BOOKKEEPER")) {
    return { ok: false, error: "Forbidden" };
  }

  const parsed = ruleSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    descriptionMatch: formData.get("descriptionMatch"),
    matchType: formData.get("matchType") || "CONTAINS",
    appliesTo: formData.get("appliesTo") || "BOTH",
    applyDeposit: formBool(formData, "applyDeposit"),
    applyWithdrawal: formBool(formData, "applyWithdrawal"),
    accountNumber: String(formData.get("accountNumber") ?? "") || null,
    accountName: String(formData.get("accountName") ?? "") || null,
    taxCodes: String(formData.get("taxCodes") ?? ""),
    provinceTaxCodes: String(formData.get("provinceTaxCodes") ?? ""),
    taxMode: formData.get("taxMode") || "INCLUSIVE",
    active: formBool(formData, "active"),
  });

  if (!parsed.success) {
    return { ok: false, error: "Invalid rule details." };
  }

  const data = {
    name: parsed.data.name,
    descriptionMatch: parsed.data.descriptionMatch,
    matchType: parsed.data.matchType,
    appliesTo: parsed.data.appliesTo,
    applyDeposit: parsed.data.applyDeposit,
    applyWithdrawal: parsed.data.applyWithdrawal,
    accountNumber: parsed.data.accountNumber,
    accountName: parsed.data.accountName,
    taxCodes: parseTaxCodes(parsed.data.taxCodes),
    provinceTaxCodes: parseTaxCodes(parsed.data.provinceTaxCodes),
    taxMode: parsed.data.taxMode,
    active: parsed.data.active,
  };

  if (parsed.data.id) {
    const existing = await prisma.rule.findFirst({
      where: { id: parsed.data.id, organizationId: organization.id },
    });
    if (!existing) return { ok: false, error: "Rule not found." };

    await prisma.rule.update({
      where: { id: existing.id },
      data,
    });
    await prisma.auditLog.create({
      data: {
        organizationId: organization.id,
        actorId: session.user.id,
        action: "rule.updated",
        entityType: "Rule",
        entityId: existing.id,
        metadata: { name: data.name },
      },
    });
  } else {
    const created = await prisma.rule.create({
      data: {
        organizationId: organization.id,
        ...data,
        isBuiltIn: false,
        learned: false,
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: organization.id,
        actorId: session.user.id,
        action: "rule.created",
        entityType: "Rule",
        entityId: created.id,
        metadata: { name: data.name },
      },
    });
  }

  revalidatePath("/app/rules");
  revalidatePath("/app");
  return { ok: true, message: "Rule saved." };
}

export async function deleteRuleAction(formData: FormData): Promise<ActionResult> {
  const { organization, session } = await requireOrgContext("BOOKKEEPER");
  const id = String(formData.get("id") ?? "");
  const existing = await prisma.rule.findFirst({
    where: { id, organizationId: organization.id },
  });
  if (!existing) return { ok: false, error: "Rule not found." };

  await prisma.rule.delete({ where: { id: existing.id } });
  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      actorId: session.user.id,
      action: "rule.deleted",
      entityType: "Rule",
      entityId: existing.id,
      metadata: { name: existing.name },
    },
  });
  if (existing.isBuiltIn) {
    const { syncStarterRulesVisibility } = await import("@/lib/rule-visibility");
    await syncStarterRulesVisibility(organization.id);
  }
  revalidatePath("/app/rules");
  return { ok: true, message: "Rule deleted." };
}

export async function toggleRuleAction(formData: FormData): Promise<void> {
  const { organization } = await requireOrgContext("BOOKKEEPER");
  const id = String(formData.get("id") ?? "");
  const existing = await prisma.rule.findFirst({
    where: { id, organizationId: organization.id },
  });
  if (!existing) return;
  await prisma.rule.update({
    where: { id: existing.id },
    data: { active: !existing.active },
  });
  revalidatePath("/app/rules");
}

function parseIds(formData: FormData) {
  return String(formData.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function splitLines(raw: string) {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
}

export async function bulkDeleteRulesAction(formData: FormData): Promise<ActionResult> {
  const { organization, role } = await requireOrgContext("BOOKKEEPER");
  if (!hasMinOrgRole(role, "BOOKKEEPER")) return { ok: false, error: "Forbidden" };
  const ids = parseIds(formData);
  if (!ids.length) return { ok: false, error: "Select rules first." };

  const result = await prisma.rule.deleteMany({
    where: { id: { in: ids }, organizationId: organization.id },
  });
  const { syncStarterRulesVisibility } = await import("@/lib/rule-visibility");
  await syncStarterRulesVisibility(organization.id);
  revalidatePath("/app/rules");
  if (result.count === 0) {
    return { ok: false, error: "No matching rules to delete for this client." };
  }
  return { ok: true, count: result.count, message: `Deleted ${result.count} rules.` };
}

export async function fillMissingPredefinedRulesAction(): Promise<ActionResult> {
  const { organization } = await requireOrgContext("BOOKKEEPER");
  const { setOrganizationStarterRulesVisible } = await import("@/lib/org-meta");
  await setOrganizationStarterRulesVisible(organization.id, true);
  const { fillMissingPredefinedRules } = await import("@/lib/ensure-org-defaults");
  const { rulesAdded } = await fillMissingPredefinedRules(prisma, organization.id);
  revalidatePath("/app/rules");
  revalidatePath("/app/tax-codes");
  if (rulesAdded === 0) {
    return {
      ok: true,
      count: 0,
      message:
        "All predefined rules are already on this client. Deleted ones can be restored from Add predefined rules.",
    };
  }
  return {
    ok: true,
    count: rulesAdded,
    message: `Added ${rulesAdded} predefined rule${rulesAdded === 1 ? "" : "s"} for this client.`,
  };
}

export async function bulkEditRulesAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { organization, role } = await requireOrgContext("BOOKKEEPER");
  if (!hasMinOrgRole(role, "BOOKKEEPER")) return { ok: false, error: "Forbidden" };
  const ids = parseIds(formData);
  if (!ids.length) return { ok: false, error: "Select rules first." };

  const data: Record<string, unknown> = {};
  if (formBool(formData, "applyAccount")) {
    data.accountNumber = String(formData.get("accountNumber") ?? "") || null;
    data.accountName = String(formData.get("accountName") ?? "") || null;
  }
  if (formBool(formData, "applyTax")) {
    data.taxCodes = parseTaxCodes(String(formData.get("taxCodes") ?? ""));
    data.provinceTaxCodes = parseTaxCodes(String(formData.get("provinceTaxCodes") ?? ""));
    const mode = String(formData.get("taxMode") ?? "INCLUSIVE");
    data.taxMode =
      mode === "EXCLUSIVE" || mode === "KEEP" || mode === "INCLUSIVE" ? mode : "INCLUSIVE";
  }
  if (formBool(formData, "applyActive")) {
    data.active = formBool(formData, "active");
  }
  if (formBool(formData, "applyAppliesTo")) {
    const appliesTo = String(formData.get("appliesTo") ?? "BOTH");
    if (["BOTH", "BANK", "CREDIT_CARD"].includes(appliesTo)) data.appliesTo = appliesTo;
  }
  if (formBool(formData, "applySides")) {
    data.applyDeposit = formBool(formData, "applyDeposit");
    data.applyWithdrawal = formBool(formData, "applyWithdrawal");
  }

  if (!Object.keys(data).length) {
    return { ok: false, error: "Choose at least one field to update." };
  }

  const result = await prisma.rule.updateMany({
    where: { id: { in: ids }, organizationId: organization.id },
    data,
  });
  revalidatePath("/app/rules");
  return { ok: true, count: result.count, message: `Updated ${result.count} rules.` };
}

export async function bulkAddRulesAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { organization, role } = await requireOrgContext("BOOKKEEPER");
  if (!hasMinOrgRole(role, "BOOKKEEPER")) return { ok: false, error: "Forbidden" };

  const names = splitLines(String(formData.get("names") ?? ""));
  const matches = splitLines(String(formData.get("matches") ?? ""));
  const accounts = splitLines(String(formData.get("accounts") ?? ""));
  const accountNumbers = splitLines(String(formData.get("accountNumbers") ?? ""));
  const taxes = splitLines(String(formData.get("taxes") ?? ""));
  const provinceTaxes = splitLines(String(formData.get("provinceTaxes") ?? ""));
  const modes = splitLines(String(formData.get("modes") ?? ""));

  const count = Math.max(names.length, matches.length);
  if (!count) return { ok: false, error: "Paste at least one rule name/match line." };

  const rows = [];
  for (let i = 0; i < count; i++) {
    const name = (names[i] ?? matches[i] ?? "").trim();
    const descriptionMatch = (matches[i] ?? names[i] ?? "").trim();
    if (!name || !descriptionMatch) continue;
    const accountName = (accounts[i] ?? "").trim() || null;
    const accountNumber = (accountNumbers[i] ?? "").trim() || null;
    const taxCodes = parseTaxCodes(taxes[i] ?? "");
    const provinceTaxCodes = parseTaxCodes(provinceTaxes[i] ?? "");
    const modeRaw = (modes[i] ?? "INCLUSIVE").trim().toUpperCase();
    const taxMode =
      modeRaw === "EXCLUSIVE" || modeRaw === "KEEP" ? modeRaw : "INCLUSIVE";
    rows.push({
      organizationId: organization.id,
      name,
      descriptionMatch,
      matchType: "CONTAINS" as const,
      appliesTo: "BOTH" as const,
      applyDeposit: true,
      applyWithdrawal: true,
      accountNumber,
      accountName,
      taxCodes,
      provinceTaxCodes,
      taxMode: taxMode as "INCLUSIVE" | "EXCLUSIVE" | "KEEP",
      active: true,
      isBuiltIn: false,
      learned: false,
    });
  }

  if (!rows.length) return { ok: false, error: "No valid pasted rules." };
  const result = await prisma.rule.createMany({ data: rows });
  revalidatePath("/app/rules");
  return { ok: true, count: result.count, message: `Added ${result.count} rules.` };
}

export async function importRulesBatchAction(formData: FormData): Promise<ActionResult> {
  const { organization, role } = await requireOrgContext("BOOKKEEPER");
  if (!hasMinOrgRole(role, "BOOKKEEPER")) return { ok: false, error: "Forbidden" };

  const raw = String(formData.get("rules") ?? "");
  if (!raw) return { ok: false, error: "No rules to import." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Invalid rules payload." };
  }
  if (!Array.isArray(parsed) || !parsed.length) {
    return { ok: false, error: "No valid rules to import." };
  }

  const rows = parsed
    .map((r) => {
      const item = r as Record<string, unknown>;
      const descriptionMatch = String(item.descriptionMatch ?? "").trim();
      const name = String(item.name ?? "").trim() || descriptionMatch;
      if (!descriptionMatch) return null;
      const matchTypeRaw = String(item.matchType ?? "CONTAINS").toUpperCase();
      const matchType = ["CONTAINS", "STARTS", "EXACT", "REGEX"].includes(matchTypeRaw)
        ? (matchTypeRaw as "CONTAINS" | "STARTS" | "EXACT" | "REGEX")
        : "CONTAINS";
      const appliesRaw = String(item.appliesTo ?? "BOTH").toUpperCase();
      const appliesTo = ["BOTH", "BANK", "CREDIT_CARD"].includes(appliesRaw)
        ? (appliesRaw as "BOTH" | "BANK" | "CREDIT_CARD")
        : "BOTH";
      const taxModeRaw = String(item.taxMode ?? "INCLUSIVE").toUpperCase();
      const taxMode: "INCLUSIVE" | "EXCLUSIVE" | "KEEP" =
        taxModeRaw === "EXCLUSIVE" || taxModeRaw === "KEEP" ? taxModeRaw : "INCLUSIVE";
      return {
        organizationId: organization.id,
        name,
        descriptionMatch,
        matchType,
        appliesTo,
        applyDeposit: item.applyDeposit !== false,
        applyWithdrawal: item.applyWithdrawal !== false,
        accountNumber: String(item.accountNumber ?? "").trim() || null,
        accountName: String(item.accountName ?? "").trim() || null,
        taxCodes: Array.isArray(item.taxCodes)
          ? item.taxCodes.map(String)
          : parseTaxCodes(String(item.taxCodes ?? "")),
        provinceTaxCodes: Array.isArray(item.provinceTaxCodes)
          ? item.provinceTaxCodes.map(String)
          : parseTaxCodes(String(item.provinceTaxCodes ?? "")),
        taxMode,
        active: item.active !== false,
        isBuiltIn: false,
        learned: false,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (!rows.length) return { ok: false, error: "No valid rules to import." };

  const result = await prisma.rule.createMany({ data: rows });
  revalidatePath("/app/rules");
  revalidatePath("/app");
  return {
    ok: true,
    count: result.count,
    message: `Imported ${result.count} rule${result.count === 1 ? "" : "s"} into your library.`,
  };
}

export async function fillMissingStarterAccountsAction(): Promise<ActionResult> {
  const { organization } = await requireOrgContext("ADMIN");
  const { setOrganizationStarterChartVisible } = await import("@/lib/org-meta");
  await setOrganizationStarterChartVisible(organization.id, true);
  const { fillMissingStarterChartAndTaxes } = await import("@/lib/ensure-org-defaults");
  const { accountsAdded, taxesAdded } = await fillMissingStarterChartAndTaxes(
    prisma,
    organization.id,
  );
  revalidatePath("/app/accounts");
  revalidatePath("/app/tax-codes");
  revalidatePath("/app/rules");
  if (accountsAdded === 0 && taxesAdded === 0) {
    return {
      ok: true,
      count: 0,
      message:
        "Your chart already includes all predefined small-business accounts. Deleted starters can be restored by clicking this button again.",
    };
  }
  const parts: string[] = [];
  if (accountsAdded) parts.push(`${accountsAdded} account${accountsAdded === 1 ? "" : "s"}`);
  if (taxesAdded) parts.push(`${taxesAdded} tax code${taxesAdded === 1 ? "" : "s"}`);
  return {
    ok: true,
    count: accountsAdded + taxesAdded,
    message: `Added ${parts.join(" and ")}. Existing numbers were not overwritten.`,
  };
}

export async function bulkDeleteAccountsAction(formData: FormData): Promise<ActionResult> {
  const { organization } = await requireOrgContext("ADMIN");
  const ids = parseIds(formData);
  if (!ids.length) return { ok: false, error: "Select accounts first." };
  try {
    const result = await prisma.chartAccount.deleteMany({
      where: { id: { in: ids }, organizationId: organization.id },
    });
    revalidatePath("/app/accounts");
    revalidatePath("/app/rules");
    revalidatePath("/app");
    if (result.count === 0) {
      return {
        ok: false,
        error: "No accounts were deleted. Refresh the page and try again.",
      };
    }
    const { syncStarterChartVisibility } = await import("@/lib/chart-account-visibility");
    await syncStarterChartVisibility(organization.id);
    return { ok: true, count: result.count, message: `Deleted ${result.count} accounts.` };
  } catch (err) {
    console.error("bulkDeleteAccountsAction", err);
    return { ok: false, error: "Could not delete selected accounts." };
  }
}

export async function bulkEditAccountsAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { organization } = await requireOrgContext("ADMIN");
  const ids = parseIds(formData);
  if (!ids.length) return { ok: false, error: "Select accounts first." };

  const data: Record<string, unknown> = {};
  if (formBool(formData, "applyType")) {
    const type = String(formData.get("type") ?? "");
    if (["INCOME", "EXPENSE", "ASSET", "LIABILITY", "EQUITY"].includes(type)) {
      data.type = type;
    }
  }
  if (formBool(formData, "applyGst")) {
    data.defaultGstCode = String(formData.get("defaultGstCode") ?? "") || null;
  }
  if (formBool(formData, "applyPst")) {
    data.defaultPstCode = String(formData.get("defaultPstCode") ?? "") || null;
  }
  if (!Object.keys(data).length) {
    return { ok: false, error: "Choose at least one field to update." };
  }

  const result = await prisma.chartAccount.updateMany({
    where: { id: { in: ids }, organizationId: organization.id },
    data,
  });
  revalidatePath("/app/accounts");
  return { ok: true, count: result.count, message: `Updated ${result.count} accounts.` };
}

export async function bulkAddAccountsAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { organization } = await requireOrgContext("ADMIN");
  const numbers = splitLines(String(formData.get("numbers") ?? ""));
  const names = splitLines(String(formData.get("names") ?? ""));
  const types = splitLines(String(formData.get("types") ?? ""));
  const gst = splitLines(String(formData.get("gst") ?? ""));
  const pst = splitLines(String(formData.get("pst") ?? ""));

  const count = Math.max(numbers.length, names.length);
  if (!count) return { ok: false, error: "Paste account numbers and names." };

  const rows = [];
  for (let i = 0; i < count; i++) {
    const number = (numbers[i] ?? "").trim();
    const name = (names[i] ?? "").trim();
    if (!number || !name) continue;
    const typeRaw = (types[i] ?? "EXPENSE").trim().toUpperCase();
    const type = ["INCOME", "EXPENSE", "ASSET", "LIABILITY", "EQUITY"].includes(typeRaw)
      ? (typeRaw as "INCOME" | "EXPENSE" | "ASSET" | "LIABILITY" | "EQUITY")
      : "EXPENSE";
    rows.push({
      organizationId: organization.id,
      number,
      name,
      type,
      defaultGstCode: (gst[i] ?? "").trim() || null,
      defaultPstCode: (pst[i] ?? "").trim() || null,
      isSystem: false,
    });
  }

  if (!rows.length) return { ok: false, error: "No valid pasted accounts." };

  let created = 0;
  for (const row of rows) {
    try {
      await prisma.chartAccount.create({ data: row });
      created += 1;
    } catch {
      // skip duplicates on unique number
    }
  }

  revalidatePath("/app/accounts");
  revalidatePath("/app/rules");
  return {
    ok: true,
    count: created,
    message: `Added ${created} accounts${rows.length - created ? ` (${rows.length - created} skipped duplicates)` : ""}.`,
  };
}

export async function importAccountsBatchAction(formData: FormData): Promise<ActionResult> {
  const { organization } = await requireOrgContext("ADMIN");

  const raw = String(formData.get("accounts") ?? "");
  if (!raw) return { ok: false, error: "No accounts to import." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Invalid import payload." };
  }
  if (!Array.isArray(parsed) || !parsed.length) {
    return { ok: false, error: "No valid accounts to import." };
  }

  let created = 0;
  let skipped = 0;
  for (const item of parsed) {
    const row = item as Record<string, unknown>;
    const number = String(row.number ?? "").trim();
    const name = String(row.name ?? "").trim();
    if (!number || !name) {
      skipped += 1;
      continue;
    }
    const typeRaw = String(row.type ?? "EXPENSE").toUpperCase();
    const type: "INCOME" | "EXPENSE" | "ASSET" | "LIABILITY" | "EQUITY" = [
      "INCOME",
      "EXPENSE",
      "ASSET",
      "LIABILITY",
      "EQUITY",
    ].includes(typeRaw)
      ? (typeRaw as "INCOME" | "EXPENSE" | "ASSET" | "LIABILITY" | "EQUITY")
      : "EXPENSE";
    try {
      await prisma.chartAccount.create({
        data: {
          organizationId: organization.id,
          number,
          name,
          type,
          defaultGstCode: String(row.defaultGstCode ?? "").trim() || null,
          defaultPstCode: String(row.defaultPstCode ?? "").trim() || null,
          isSystem: false,
        },
      });
      created += 1;
    } catch {
      skipped += 1;
    }
  }

  if (!created) {
    return { ok: false, error: "No new accounts were imported (duplicates or invalid rows)." };
  }

  revalidatePath("/app/accounts");
  revalidatePath("/app/rules");
  return {
    ok: true,
    count: created,
    message: `Imported ${created} account${created === 1 ? "" : "s"}${skipped ? ` (${skipped} skipped)` : ""}.`,
  };
}

export async function bulkDeleteTaxCodesAction(formData: FormData): Promise<ActionResult> {
  const { organization } = await requireOrgContext("ADMIN");
  const ids = parseIds(formData);
  if (!ids.length) return { ok: false, error: "Select tax codes first." };
  const result = await prisma.taxCode.deleteMany({
    where: { id: { in: ids }, organizationId: organization.id },
  });
  revalidatePath("/app/tax-codes");
  return { ok: true, count: result.count, message: `Deleted ${result.count} tax codes.` };
}

export async function bulkEditTaxCodesAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { organization } = await requireOrgContext("ADMIN");
  const ids = parseIds(formData);
  if (!ids.length) return { ok: false, error: "Select tax codes first." };

  const data: Record<string, unknown> = {};
  if (formBool(formData, "applyKind")) {
    const kind = String(formData.get("kind") ?? "");
    if (["GST_HST", "PST", "OTHER", "NONE"].includes(kind)) data.kind = kind;
  }
  if (formBool(formData, "applyRate")) {
    data.rate = Number(formData.get("rate") ?? 0);
  }
  if (formBool(formData, "applyProvince")) {
    data.province = String(formData.get("province") ?? "") || null;
  }
  if (!Object.keys(data).length) {
    return { ok: false, error: "Choose at least one field to update." };
  }

  const result = await prisma.taxCode.updateMany({
    where: { id: { in: ids }, organizationId: organization.id },
    data,
  });
  revalidatePath("/app/tax-codes");
  return { ok: true, count: result.count, message: `Updated ${result.count} tax codes.` };
}

export async function bulkAddTaxCodesAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { organization } = await requireOrgContext("ADMIN");
  const codes = splitLines(String(formData.get("codes") ?? ""));
  const names = splitLines(String(formData.get("names") ?? ""));
  const rates = splitLines(String(formData.get("rates") ?? ""));
  const kinds = splitLines(String(formData.get("kinds") ?? ""));
  const provinces = splitLines(String(formData.get("provinces") ?? ""));

  const count = Math.max(codes.length, names.length);
  if (!count) return { ok: false, error: "Paste tax codes and names." };

  const rows = [];
  for (let i = 0; i < count; i++) {
    const code = (codes[i] ?? "").trim();
    const name = (names[i] ?? code).trim();
    if (!code || !name) continue;
    const rate = Number.parseFloat((rates[i] ?? "0").replace(/[^0-9.]/g, "")) || 0;
    const kindRaw = (kinds[i] ?? "GST_HST").trim().toUpperCase().replace(/\s+/g, "_");
    const kind = ["GST_HST", "PST", "OTHER", "NONE"].includes(kindRaw)
      ? (kindRaw as "GST_HST" | "PST" | "OTHER" | "NONE")
      : kindRaw.includes("PST") || kindRaw.includes("QST") || kindRaw.includes("RST")
        ? ("PST" as const)
        : ("GST_HST" as const);
    rows.push({
      organizationId: organization.id,
      code,
      name,
      rate,
      kind,
      province: (provinces[i] ?? "").trim().toUpperCase() || null,
      isSystem: false,
    });
  }

  if (!rows.length) return { ok: false, error: "No valid tax codes." };

  let created = 0;
  for (const row of rows) {
    try {
      await prisma.taxCode.create({ data: row });
      created += 1;
    } catch {
      // skip duplicate codes
    }
  }

  revalidatePath("/app/tax-codes");
  return {
    ok: true,
    count: created,
    message: `Added ${created} tax codes${rows.length - created ? ` (${rows.length - created} skipped duplicates)` : ""}.`,
  };
}

export async function importTaxCodesBatchAction(formData: FormData): Promise<ActionResult> {
  const { organization } = await requireOrgContext("ADMIN");

  const raw = String(formData.get("codes") ?? "");
  if (!raw) return { ok: false, error: "No tax codes to import." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Invalid import payload." };
  }
  if (!Array.isArray(parsed) || !parsed.length) {
    return { ok: false, error: "No valid tax codes to import." };
  }

  let created = 0;
  let skipped = 0;
  for (const item of parsed) {
    const row = item as Record<string, unknown>;
    const code = String(row.code ?? "").trim();
    const name = String(row.name ?? "").trim() || code;
    if (!code) {
      skipped += 1;
      continue;
    }
    const kindRaw = String(row.kind ?? "GST_HST").toUpperCase();
    const kind: "GST_HST" | "PST" | "OTHER" | "NONE" = ["GST_HST", "PST", "OTHER", "NONE"].includes(
      kindRaw,
    )
      ? (kindRaw as "GST_HST" | "PST" | "OTHER" | "NONE")
      : "GST_HST";
    const rate = Number(row.rate);
    try {
      await prisma.taxCode.create({
        data: {
          organizationId: organization.id,
          code,
          name,
          rate: Number.isFinite(rate) ? rate : 0,
          kind,
          province: String(row.province ?? "").trim().toUpperCase() || null,
          isSystem: false,
        },
      });
      created += 1;
    } catch {
      skipped += 1;
    }
  }

  if (!created) {
    return { ok: false, error: "No new tax codes were imported (duplicates or invalid rows)." };
  }

  revalidatePath("/app/tax-codes");
  revalidatePath("/app/rules");
  return {
    ok: true,
    count: created,
    message: `Imported ${created} tax code${created === 1 ? "" : "s"}${skipped ? ` (${skipped} skipped)` : ""}.`,
  };
}

const accountSchema = z.object({
  id: z.string().optional(),
  number: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  type: z.enum(["INCOME", "EXPENSE", "ASSET", "LIABILITY", "EQUITY"]),
  defaultGstCode: z.string().optional().nullable(),
  defaultPstCode: z.string().optional().nullable(),
});

export async function saveAccountAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { organization } = await requireOrgContext("ADMIN");
  const parsed = accountSchema.safeParse({
    id: formData.get("id") || undefined,
    number: formData.get("number"),
    name: formData.get("name"),
    type: formData.get("type"),
    defaultGstCode: String(formData.get("defaultGstCode") ?? "") || null,
    defaultPstCode: String(formData.get("defaultPstCode") ?? "") || null,
  });
  if (!parsed.success) return { ok: false, error: "Invalid account." };

  if (parsed.data.id) {
    const existing = await prisma.chartAccount.findFirst({
      where: { id: parsed.data.id, organizationId: organization.id },
    });
    if (!existing) return { ok: false, error: "Account not found." };
    await prisma.chartAccount.update({
      where: { id: existing.id },
      data: {
        number: parsed.data.number,
        name: parsed.data.name,
        type: parsed.data.type,
        defaultGstCode: parsed.data.defaultGstCode,
        defaultPstCode: parsed.data.defaultPstCode,
      },
    });
  } else {
    await prisma.chartAccount.create({
      data: {
        organizationId: organization.id,
        number: parsed.data.number,
        name: parsed.data.name,
        type: parsed.data.type,
        defaultGstCode: parsed.data.defaultGstCode,
        defaultPstCode: parsed.data.defaultPstCode,
      },
    });
  }
  revalidatePath("/app/accounts");
  revalidatePath("/app/rules");
  return { ok: true, message: "Account saved." };
}

export async function deleteAccountAction(formData: FormData): Promise<void> {
  const { organization } = await requireOrgContext("ADMIN");
  const id = String(formData.get("id") ?? "");
  await prisma.chartAccount.deleteMany({
    where: { id, organizationId: organization.id },
  });
  const { syncStarterChartVisibility } = await import("@/lib/chart-account-visibility");
  await syncStarterChartVisibility(organization.id);
  revalidatePath("/app/accounts");
}

const taxSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  rate: z.coerce.number().min(0).max(100),
  kind: z.enum(["GST_HST", "PST", "OTHER", "NONE"]),
  province: z.string().max(4).optional().nullable(),
});

export async function saveTaxCodeAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { organization } = await requireOrgContext("ADMIN");
  const parsed = taxSchema.safeParse({
    id: formData.get("id") || undefined,
    code: formData.get("code"),
    name: formData.get("name"),
    rate: formData.get("rate"),
    kind: formData.get("kind"),
    province: String(formData.get("province") ?? "") || null,
  });
  if (!parsed.success) return { ok: false, error: "Invalid tax code." };

  if (parsed.data.id) {
    await prisma.taxCode.updateMany({
      where: { id: parsed.data.id, organizationId: organization.id },
      data: {
        code: parsed.data.code,
        name: parsed.data.name,
        rate: parsed.data.rate,
        kind: parsed.data.kind,
        province: parsed.data.province,
      },
    });
  } else {
    await prisma.taxCode.create({
      data: {
        organizationId: organization.id,
        code: parsed.data.code,
        name: parsed.data.name,
        rate: parsed.data.rate,
        kind: parsed.data.kind,
        province: parsed.data.province,
      },
    });
  }
  revalidatePath("/app/tax-codes");
  revalidatePath("/app/rules");
  return { ok: true, message: "Tax code saved." };
}

export async function deleteTaxCodeAction(formData: FormData): Promise<void> {
  const { organization } = await requireOrgContext("ADMIN");
  const id = String(formData.get("id") ?? "");
  await prisma.taxCode.deleteMany({
    where: { id, organizationId: organization.id },
  });
  revalidatePath("/app/tax-codes");
}

function parseImportDate(raw: string): Date | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  // Guard absurd OCR dates that Prisma/Postgres reject
  const year = d.getUTCFullYear();
  if (year < 1990 || year > 2100) return null;
  return d;
}

export async function importTransactionsAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const { organization, activeBankId, role, session } = await requireOrgContext("BOOKKEEPER");
    if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };

    const payloadRaw = String(formData.get("payload") ?? "");
    if (!payloadRaw) return { ok: false, error: "No import payload." };

    let payload: {
      rows: Array<{
        date: string;
        description: string;
        moneyIn: number;
        moneyOut: number;
        accountNumber?: string;
        accountName?: string;
        province?: string;
        notes?: string;
        externalTransactionId?: string;
      }>;
      applyRules: boolean;
      replaceExisting?: boolean;
      bankAccountId?: string;
      newBankName?: string;
      newBankType?: "BANK" | "CREDIT_CARD";
    };

    try {
      payload = JSON.parse(payloadRaw);
    } catch {
      return { ok: false, error: "Invalid import payload." };
    }

    if (!payload.rows?.length) return { ok: false, error: "No rows to import." };

    const { getOrganizationDefaultProvince } = await import("@/lib/org-meta");
    const clientProvince = await getOrganizationDefaultProvince(organization.id);

    const taxCodeRows = await prisma.taxCode.findMany({
      where: { organizationId: organization.id },
      select: { code: true, kind: true, province: true, rate: true },
    });
    const { resolveProvinceTaxCode } = await import("@/lib/province-tax-profile");
    const defaultPstCode = resolveProvinceTaxCode(
      clientProvince,
      taxCodeRows.map((t) => ({
        code: t.code,
        kind: t.kind,
        province: t.province,
        rate: Number(t.rate),
      })),
    );

    let bank =
      payload.bankAccountId
        ? await prisma.bankAccount.findFirst({
            where: {
              id: payload.bankAccountId,
              organizationId: organization.id,
              isArchived: false,
            },
          })
        : null;

    if (!bank && payload.newBankName?.trim()) {
      bank = await prisma.bankAccount.create({
        data: {
          organizationId: organization.id,
          name: payload.newBankName.trim(),
          type: payload.newBankType === "CREDIT_CARD" ? "CREDIT_CARD" : "BANK",
          currency: "CAD",
        },
      });
    }

    if (!bank && activeBankId) {
      bank = await prisma.bankAccount.findFirst({
        where: {
          id: activeBankId,
          organizationId: organization.id,
          isArchived: false,
        },
      });
    }

    // Still no bank? Auto-create a working bank so imports never block on setup.
    if (!bank) {
      bank = await prisma.bankAccount.create({
        data: {
          organizationId: organization.id,
          name: "Imported Statements",
          type: "BANK",
          currency: "CAD",
          institutionName: "Manual import",
        },
      });
    }

    await prisma.userPreference.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        activeOrganizationId: organization.id,
        activeBankAccountId: bank.id,
      },
      update: {
        activeOrganizationId: organization.id,
        activeBankAccountId: bank.id,
      },
    });

    if (payload.replaceExisting) {
      await prisma.transaction.deleteMany({
        where: {
          organizationId: organization.id,
          bankAccountId: bank.id,
        },
      });
    }

    const externalIds = [
      ...new Set(
        payload.rows
          .map((r) => String(r.externalTransactionId ?? "").trim())
          .filter(Boolean),
      ),
    ];

    const existingExternalIds = new Set(
      externalIds.length
        ? (
            await prisma.transaction.findMany({
              where: {
                bankAccountId: bank.id,
                externalTransactionId: { in: externalIds },
              },
              select: { externalTransactionId: true },
            })
          )
            .map((t) => t.externalTransactionId)
            .filter((id): id is string => Boolean(id))
        : [],
    );

    const rules = payload.applyRules
      ? await prisma.rule.findMany({
          where: { organizationId: organization.id, active: true },
          orderBy: [{ isBuiltIn: "asc" }, { createdAt: "asc" }],
        })
      : [];

    const { findMatchingRule } = await import("@/lib/rules-engine");

    const seenExternalInBatch = new Set<string>();
    let invalidDates = 0;
    let skippedDupes = 0;

    const prepared: Array<{
      organizationId: string;
      bankAccountId: string;
      date: Date;
      description: string;
      moneyIn: number;
      moneyOut: number;
      accountNumber: string | null;
      accountName: string | null;
      province: string | null;
      notes: string | null;
      externalTransactionId: string | null;
      taxCodes: string[];
      provinceTaxCodes: string[];
      taxMode: "INCLUSIVE" | "EXCLUSIVE" | "KEEP";
    }> = [];

    for (const row of payload.rows) {
      const date = parseImportDate(row.date);
      if (!date) {
        invalidDates += 1;
        continue;
      }

      const externalId = String(row.externalTransactionId ?? "").trim() || null;
      if (externalId) {
        if (existingExternalIds.has(externalId) || seenExternalInBatch.has(externalId)) {
          skippedDupes += 1;
          continue;
        }
        seenExternalInBatch.add(externalId);
      }

      const moneyIn = Number(row.moneyIn) || 0;
      const moneyOut = Number(row.moneyOut) || 0;
      const description = String(row.description ?? "").trim() || "Imported transaction";

      // When applyRules is on, matching rules override any CSV/OCR category.
      const match = payload.applyRules
        ? findMatchingRule(rules, {
            description,
            moneyIn,
            moneyOut,
            statementType: bank.type,
          })
        : null;

      // Only inherit client province when the org actually has one set.
      // No client province → leave transaction province blank (None).
      const rowProvince = String(row.province ?? "").trim().toUpperCase() || null;
      const province = rowProvince || clientProvince || null;
      let provinceTaxCodes = match?.provinceTaxCodes ?? [];
      if (!provinceTaxCodes.length && province && defaultPstCode) {
        provinceTaxCodes = [defaultPstCode];
      }

      prepared.push({
        organizationId: organization.id,
        bankAccountId: bank.id,
        date,
        description: description.slice(0, 2000),
        moneyIn,
        moneyOut,
        accountNumber: (match?.accountNumber ?? row.accountNumber ?? null)?.slice(0, 40) ?? null,
        accountName: (match?.accountName ?? row.accountName ?? null)?.slice(0, 160) ?? null,
        province,
        notes: row.notes ? String(row.notes).slice(0, 2000) : null,
        externalTransactionId: externalId,
        taxCodes: match?.taxCodes ?? [],
        provinceTaxCodes,
        taxMode: match?.taxMode ?? "INCLUSIVE",
      });
    }

    if (!prepared.length) {
      if (invalidDates && !skippedDupes) {
        return {
          ok: false,
          error: `No valid rows to import (${invalidDates} had invalid dates from OCR/AI).`,
        };
      }
      return {
        ok: false,
        error: skippedDupes
          ? "All rows already imported (duplicate FITIDs)."
          : "No valid rows to import.",
      };
    }

    // Chunked createMany — avoids interactive-transaction timeouts on large scanned PDFs.
    const CHUNK = 75;
    let createdCount = 0;
    for (let i = 0; i < prepared.length; i += CHUNK) {
      const chunk = prepared.slice(i, i + CHUNK);
      const result = await prisma.transaction.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      createdCount += result.count;
    }

    const skipped = payload.rows.length - createdCount;

    await prisma.auditLog.create({
      data: {
        organizationId: organization.id,
        actorId: session.user.id,
        action: "transactions.imported",
        entityType: "BankAccount",
        entityId: bank.id,
        metadata: {
          count: createdCount,
          skipped,
          invalidDates,
          skippedDupes,
          applyRules: payload.applyRules,
          bankName: bank.name,
        },
      },
    });

    revalidatePath("/app");
    const extras = [
      skippedDupes ? `${skippedDupes} duplicates skipped` : null,
      invalidDates ? `${invalidDates} invalid dates skipped` : null,
    ].filter(Boolean);
    return {
      ok: true,
      count: createdCount,
      message: `Imported ${createdCount} into ${bank.name}${extras.length ? ` (${extras.join(", ")})` : ""}.`,
    };
  } catch (error) {
    console.error("[importTransactionsAction]", error);
    const message =
      error instanceof Error ? error.message : "Import failed unexpectedly.";
    // Never throw — production Server Actions turn throws into opaque 500 digests.
    return {
      ok: false,
      error: message.slice(0, 300),
    };
  }
}

export async function applyRulesToTransactionsAction(): Promise<ActionResult> {
  const { organization, activeBankId, role } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };

  const banks = await prisma.bankAccount.findMany({
    where: { organizationId: organization.id, isArchived: false },
  });
  if (!banks.length) return { ok: false, error: "No banks/transactions yet." };

  const bankTypeById = new Map(banks.map((b) => [b.id, b.type]));

  const [rules, transactions] = await Promise.all([
    prisma.rule.findMany({
      where: { organizationId: organization.id, active: true },
      orderBy: [{ isBuiltIn: "asc" }, { createdAt: "asc" }],
    }),
    // Include already-categorized rows — matching rules override existing Account/Category.
    prisma.transaction.findMany({
      where: {
        organizationId: organization.id,
        ...(activeBankId ? { bankAccountId: activeBankId } : {}),
      },
    }),
  ]);

  const { findMatchingRule } = await import("@/lib/rules-engine");
  let updated = 0;
  let overridden = 0;
  for (const tx of transactions) {
    const statementType = bankTypeById.get(tx.bankAccountId) ?? "BANK";
    const match = findMatchingRule(rules, {
      description: tx.description,
      moneyIn: Number(tx.moneyIn),
      moneyOut: Number(tx.moneyOut),
      statementType,
    });
    if (!match) continue;

    const hadCategory = Boolean(tx.accountName?.trim());
    const categoryChanged =
      hadCategory &&
      (tx.accountName !== match.accountName || tx.accountNumber !== match.accountNumber);

    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        accountNumber: match.accountNumber,
        accountName: match.accountName,
        taxCodes: match.taxCodes,
        provinceTaxCodes: match.provinceTaxCodes,
        taxMode: match.taxMode,
      },
    });
    updated += 1;
    if (categoryChanged) overridden += 1;
  }

  revalidatePath("/app");
  const overrideNote = overridden ? ` (${overridden} overridden)` : "";
  return {
    ok: true,
    count: updated,
    message: `Applied rules to ${updated} transactions${overrideNote}.`,
  };
}

export async function bulkCategorizeAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { organization, role } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };

  const scope = String(formData.get("scope") ?? "selected");
  let ids = String(formData.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (scope === "all") {
    const rows = await prisma.transaction.findMany({
      where: { organizationId: organization.id },
      select: { id: true },
    });
    ids = rows.map((r) => r.id);
  }

  if (ids.length === 0) return { ok: false, error: "Select at least one transaction." };

  const applyPosting = formData.get("applyPostingAccount") === "true";
  const applyAccount = formData.get("applyAccount") === "true";
  const applyProvince = formData.get("applyProvince") === "true";
  const applyTax = formData.get("applyTax") === "true";
  const applySalesTax = formData.get("applySalesTax") === "true" || applyTax;
  const applyPstTax = formData.get("applyPstTax") === "true" || applyTax;
  const applyTaxMode = formData.get("applyTaxMode") === "true";

  if (
    !applyPosting &&
    !applyAccount &&
    !applyProvince &&
    !applySalesTax &&
    !applyPstTax &&
    !applyTaxMode
  ) {
    return { ok: false, error: "Choose at least one field to bulk edit." };
  }

  const data: {
    bankAccountId?: string;
    accountNumber?: string | null;
    accountName?: string | null;
    taxCodes?: string[];
    provinceTaxCodes?: string[];
    taxMode?: "INCLUSIVE" | "EXCLUSIVE";
    province?: string | null;
  } = {};

  if (applyPosting) {
    const bankAccountId = String(formData.get("bankAccountId") ?? "");
    const bank = await prisma.bankAccount.findFirst({
      where: { id: bankAccountId, organizationId: organization.id },
    });
    if (!bank) return { ok: false, error: "Invalid posting account." };
    data.bankAccountId = bank.id;
  }

  if (applyAccount) {
    const accountName = String(formData.get("accountName") ?? "") || null;
    if (!accountName) return { ok: false, error: "Choose an account / category." };
    data.accountNumber = String(formData.get("accountNumber") ?? "") || null;
    data.accountName = accountName;
  }

  if (applyProvince) {
    const province = String(formData.get("province") ?? "").trim().toUpperCase() || null;
    data.province = province;
    if (province && !applyPstTax) {
      const pst = await prisma.taxCode.findFirst({
        where: {
          organizationId: organization.id,
          kind: "PST",
          province,
        },
      });
      if (pst) data.provinceTaxCodes = [pst.code];
    }
  }

  const orgTaxCatalog = await prisma.taxCode.findMany({
    where: { organizationId: organization.id },
    select: { code: true, kind: true },
  });
  const { normalizeTaxCodeAssignment } = await import("@/lib/tax-reports");

  if (applySalesTax || applyPstTax) {
    const rawSales = parseTaxCodes(String(formData.get("taxCodes") ?? ""));
    const rawPst = parseTaxCodes(String(formData.get("provinceTaxCodes") ?? ""));
    const normalized = normalizeTaxCodeAssignment(rawSales, rawPst, orgTaxCatalog);
    if (applySalesTax) data.taxCodes = normalized.taxCodes;
    if (applyPstTax) data.provinceTaxCodes = normalized.provinceTaxCodes;
  }

  if (applyTaxMode) {
    const taxModeRaw = String(formData.get("taxMode") ?? "INCLUSIVE");
    data.taxMode =
      taxModeRaw === "EXCLUSIVE" || taxModeRaw === "INCLUSIVE" ? taxModeRaw : "INCLUSIVE";
  }

  const result = await prisma.transaction.updateMany({
    where: {
      id: { in: ids },
      organizationId: organization.id,
    },
    data,
  });

  revalidatePath("/app");
  return {
    ok: true,
    count: result.count,
    message: `Updated ${result.count} transactions.`,
  };
}

export async function duplicateTransactionsAction(formData: FormData): Promise<ActionResult> {
  const { organization, role } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };
  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!ids.length) return { ok: false, error: "Nothing to duplicate." };

  const sources = await prisma.transaction.findMany({
    where: { id: { in: ids }, organizationId: organization.id },
  });
  if (!sources.length) return { ok: false, error: "Transactions not found." };

  for (const s of sources) {
    await prisma.transaction.create({
      data: {
        organizationId: s.organizationId,
        bankAccountId: s.bankAccountId,
        date: s.date,
        description: s.description,
        moneyIn: s.moneyIn,
        moneyOut: s.moneyOut,
        accountNumber: s.accountNumber,
        accountName: s.accountName,
        province: s.province,
        taxCodes: [...s.taxCodes],
        provinceTaxCodes: [...s.provinceTaxCodes],
        taxMode: s.taxMode,
        notes: s.notes,
        externalTransactionId: null,
        reconciledIn: false,
        reconciledOut: false,
      },
    });
  }
  revalidatePath("/app");
  return {
    ok: true,
    count: sources.length,
    message: `Duplicated ${sources.length} transaction${sources.length === 1 ? "" : "s"}.`,
  };
}

export async function deleteAllTransactionsAction(): Promise<ActionResult> {
  const { organization, activeBankId, role } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };

  const result = await prisma.transaction.deleteMany({
    where: {
      organizationId: organization.id,
      ...(activeBankId ? { bankAccountId: activeBankId } : {}),
    },
  });
  revalidatePath("/app");
  return {
    ok: true,
    count: result.count,
    message: `Cleared ${result.count} transaction${result.count === 1 ? "" : "s"}.`,
  };
}

export async function deleteTransactionsAction(formData: FormData): Promise<ActionResult> {
  const { organization, activeBankId, role } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };
  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!ids.length) return { ok: false, error: "Nothing selected." };

  const result = await prisma.transaction.deleteMany({
    where: {
      id: { in: ids },
      organizationId: organization.id,
      ...(activeBankId ? { bankAccountId: activeBankId } : {}),
    },
  });
  revalidatePath("/app");
  return { ok: true, count: result.count, message: `Deleted ${result.count} transactions.` };
}

/** Swap Money In ↔ Money Out for selected transactions (debit/credit flip). */
export async function swapDebitCreditAction(formData: FormData): Promise<ActionResult> {
  const { organization, role } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };
  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!ids.length) return { ok: false, error: "Select at least one transaction." };

  const sources = await prisma.transaction.findMany({
    where: { id: { in: ids }, organizationId: organization.id },
    select: { id: true, moneyIn: true, moneyOut: true },
  });
  if (!sources.length) return { ok: false, error: "Transactions not found." };

  await prisma.$transaction(
    sources.map((tx) =>
      prisma.transaction.update({
        where: { id: tx.id },
        data: {
          moneyIn: tx.moneyOut,
          moneyOut: tx.moneyIn,
        },
      }),
    ),
  );

  revalidatePath("/app");
  revalidatePath("/app/gst");
  revalidatePath("/app/pst");
  revalidatePath("/app/general-entries");
  revalidatePath("/app/reconciliation");
  return {
    ok: true,
    count: sources.length,
    message: `Swapped Money In ↔ Money Out on ${sources.length} transaction${sources.length === 1 ? "" : "s"}.`,
  };
}

export async function updateTransactionAction(formData: FormData): Promise<ActionResult> {
  const { organization, role } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };

  const id = String(formData.get("id") ?? "");
  const existing = await prisma.transaction.findFirst({
    where: { id, organizationId: organization.id },
  });
  if (!existing) return { ok: false, error: "Transaction not found." };

  const catalog = await prisma.taxCode.findMany({
    where: { organizationId: organization.id },
    select: { code: true, kind: true },
  });
  const { normalizeTaxCodeAssignment } = await import("@/lib/tax-reports");
  const normalizedTaxes = normalizeTaxCodeAssignment(
    parseTaxCodes(String(formData.get("taxCodes") ?? "")),
    parseTaxCodes(String(formData.get("provinceTaxCodes") ?? "")),
    catalog,
  );

  await prisma.transaction.update({
    where: { id },
    data: {
      description: String(formData.get("description") ?? existing.description),
      accountNumber: String(formData.get("accountNumber") ?? "") || null,
      accountName: String(formData.get("accountName") ?? "") || null,
      province: String(formData.get("province") ?? "") || null,
      notes: String(formData.get("notes") ?? "") || null,
      taxCodes: normalizedTaxes.taxCodes,
      provinceTaxCodes: normalizedTaxes.provinceTaxCodes,
      taxMode:
        String(formData.get("taxMode") ?? existing.taxMode) === "EXCLUSIVE"
          ? "EXCLUSIVE"
          : "INCLUSIVE",
    },
  });
  revalidatePath("/app");
  return { ok: true, message: "Transaction updated." };
}
