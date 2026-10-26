"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { canEditTransactions, hasMinOrgRole } from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";

export type TransactionRowPatch = {
  id: string;
  bankAccountId: string;
  date: string;
  description: string;
  moneyIn: number;
  moneyOut: number;
  accountNumber: string | null;
  accountName: string | null;
  province: string | null;
  taxCodes: string[];
  provinceTaxCodes: string[];
  taxMode: string;
  notes: string | null;
  bankName: string;
  bankType: "BANK" | "CREDIT_CARD";
};

export type ActionResult = {
  ok: boolean;
  error?: string;
  message?: string;
  id?: string;
  count?: number;
  patch?: TransactionRowPatch;
};

export async function createFolderAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { organization, role } = await requireOrgContext("BOOKKEEPER");
  if (!hasMinOrgRole(role, "BOOKKEEPER")) return { ok: false, error: "Forbidden" };

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 1) return { ok: false, error: "Folder name is required." };

  const folder = await prisma.folder.create({
    data: { organizationId: organization.id, name },
  });

  revalidatePath("/app");
  revalidatePath("/app/folders");
  revalidatePath("/app/settings");
  return { ok: true, message: "Folder created.", id: folder.id };
}

export async function renameFolderAction(formData: FormData): Promise<ActionResult> {
  const { organization } = await requireOrgContext("BOOKKEEPER");
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return { ok: false, error: "Invalid folder." };

  await prisma.folder.updateMany({
    where: { id, organizationId: organization.id },
    data: { name },
  });
  revalidatePath("/app/folders");
  revalidatePath("/app");
  return { ok: true, message: "Folder renamed." };
}

export async function deleteFolderAction(formData: FormData): Promise<ActionResult> {
  const { organization } = await requireOrgContext("ADMIN");
  const id = String(formData.get("id") ?? "");
  const folder = await prisma.folder.findFirst({
    where: { id, organizationId: organization.id },
    include: { _count: { select: { conversions: true } } },
  });
  if (!folder) return { ok: false, error: "Folder not found." };
  if (folder._count.conversions > 0) {
    return {
      ok: false,
      error: "Folder has saved conversions. Delete or move them first.",
    };
  }
  await prisma.folder.delete({ where: { id } });
  revalidatePath("/app/folders");
  return { ok: true, message: "Folder deleted." };
}

const saveSchema = z.object({
  name: z.string().min(1).max(160),
  folderId: z.string().min(1),
  newFolderName: z.string().max(120).optional(),
  bankAccountId: z.string().optional(),
  updateConversionId: z.string().optional(),
});

async function buildConversionSnapshot(
  organizationId: string,
  organizationName: string,
  bankFilter: string | undefined,
) {
  const transactions = await prisma.transaction.findMany({
    where: {
      organizationId,
      ...(bankFilter ? { bankAccountId: bankFilter } : {}),
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  if (!transactions.length) {
    return { error: "No transactions to save." as const };
  }

  const [rules, taxCodes, accounts] = await Promise.all([
    prisma.rule.findMany({ where: { organizationId } }),
    prisma.taxCode.findMany({ where: { organizationId } }),
    prisma.chartAccount.findMany({ where: { organizationId } }),
  ]);

  const snapshot = {
    version: 1,
    savedAt: new Date().toISOString(),
    organizationId,
    organizationName,
    bankAccountId: bankFilter ?? null,
    transactionCount: transactions.length,
    transactions: transactions.map((tx) => ({
      id: tx.id,
      bankAccountId: tx.bankAccountId,
      date: tx.date.toISOString().slice(0, 10),
      description: tx.description,
      moneyIn: Number(tx.moneyIn),
      moneyOut: Number(tx.moneyOut),
      accountNumber: tx.accountNumber,
      accountName: tx.accountName,
      province: tx.province,
      taxCodes: tx.taxCodes,
      provinceTaxCodes: tx.provinceTaxCodes,
      taxMode: tx.taxMode,
      notes: tx.notes,
      externalTransactionId: tx.externalTransactionId,
      transferMatchId: tx.transferMatchId,
      reconciledIn: tx.reconciledIn,
      reconciledOut: tx.reconciledOut,
    })),
    settings: {
      rules: rules.map((r) => ({
        id: r.id,
        name: r.name,
        descriptionMatch: r.descriptionMatch,
        accountName: r.accountName,
        taxCodes: r.taxCodes,
        provinceTaxCodes: r.provinceTaxCodes,
        active: r.active,
      })),
      taxCodes: taxCodes.map((t) => ({
        code: t.code,
        rate: Number(t.rate),
        kind: t.kind,
      })),
      accounts: accounts.map((a) => ({
        number: a.number,
        name: a.name,
        type: a.type,
      })),
    },
  };

  return { snapshot, count: transactions.length };
}

export async function saveConversionAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { organization, activeBankId, role, session } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };

  const parsed = saveSchema.safeParse({
    name: formData.get("name"),
    folderId: formData.get("folderId"),
    newFolderName: String(formData.get("newFolderName") ?? "") || undefined,
    bankAccountId: String(formData.get("bankAccountId") ?? "") || undefined,
    updateConversionId: String(formData.get("updateConversionId") ?? "") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: "Choose a folder and enter a save name." };
  }

  const bankFilter = parsed.data.bankAccountId || activeBankId || undefined;
  const built = await buildConversionSnapshot(
    organization.id,
    organization.name,
    bankFilter,
  );
  if ("error" in built) return { ok: false, error: built.error };

  const updateId = parsed.data.updateConversionId?.trim();
  if (updateId) {
    const existing = await prisma.savedConversion.findFirst({
      where: { id: updateId, folder: { organizationId: organization.id } },
      include: { folder: true },
    });
    if (!existing) return { ok: false, error: "Saved conversion to update was not found." };

    const saved = await prisma.savedConversion.update({
      where: { id: existing.id },
      data: {
        name: parsed.data.name.trim(),
        snapshot: built.snapshot,
      },
      include: { folder: true },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: organization.id,
        actorId: session.user.id,
        action: "conversion.updated",
        entityType: "SavedConversion",
        entityId: saved.id,
        metadata: {
          name: saved.name,
          folder: saved.folder.name,
          count: built.count,
        },
      },
    });

    revalidatePath("/app");
    revalidatePath("/app/folders");
    return {
      ok: true,
      id: saved.id,
      message: `Updated “${saved.name}” in folder “${saved.folder.name}”.`,
    };
  }

  let folderId = parsed.data.folderId;
  if (folderId === "__new__") {
    const folderName = parsed.data.newFolderName?.trim();
    if (!folderName) return { ok: false, error: "Enter a new folder name." };
    const folder = await prisma.folder.create({
      data: { organizationId: organization.id, name: folderName },
    });
    folderId = folder.id;
  } else {
    const folder = await prisma.folder.findFirst({
      where: { id: folderId, organizationId: organization.id },
    });
    if (!folder) return { ok: false, error: "Selected folder not found." };
  }

  const saved = await prisma.savedConversion.create({
    data: {
      folderId,
      name: parsed.data.name.trim(),
      snapshot: built.snapshot,
    },
    include: { folder: true },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      actorId: session.user.id,
      action: "conversion.saved",
      entityType: "SavedConversion",
      entityId: saved.id,
      metadata: {
        name: saved.name,
        folder: saved.folder.name,
        count: built.count,
      },
    },
  });

  revalidatePath("/app");
  revalidatePath("/app/folders");
  return {
    ok: true,
    id: saved.id,
    message: `Saved “${saved.name}” in folder “${saved.folder.name}”.`,
  };
}

export async function deleteSavedConversionAction(formData: FormData): Promise<ActionResult> {
  const { organization } = await requireOrgContext("BOOKKEEPER");
  const id = String(formData.get("id") ?? "");
  const saved = await prisma.savedConversion.findFirst({
    where: { id, folder: { organizationId: organization.id } },
  });
  if (!saved) return { ok: false, error: "Saved conversion not found." };
  await prisma.savedConversion.delete({ where: { id } });
  revalidatePath("/app/folders");
  revalidatePath("/app");
  return { ok: true, message: "Saved conversion deleted." };
}

export async function bulkDeleteSavedConversionsAction(
  formData: FormData,
): Promise<ActionResult> {
  const { organization } = await requireOrgContext("BOOKKEEPER");
  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!ids.length) return { ok: false, error: "Select saved conversions first." };

  const result = await prisma.savedConversion.deleteMany({
    where: {
      id: { in: ids },
      folder: { organizationId: organization.id },
    },
  });
  revalidatePath("/app/folders");
  revalidatePath("/app");
  return {
    ok: true,
    count: result.count,
    message: `Deleted ${result.count} saved conversion(s).`,
  };
}

type LoadedConversionMeta = {
  organizationId: string;
  conversionId: string;
  conversionName: string;
  folderId: string;
  folderName: string;
  count: number;
};

async function loadSavedConversionIntoWorkspace(
  organizationId: string,
  userId: string,
  savedConversionId: string,
  replace: boolean,
): Promise<{ ok: true; meta: LoadedConversionMeta } | { ok: false; error: string }> {
  const saved = await prisma.savedConversion.findFirst({
    where: { id: savedConversionId, folder: { organizationId } },
    include: { folder: true },
  });
  if (!saved) return { ok: false, error: "Saved conversion not found." };

  const snapshot = saved.snapshot as {
    transactions?: Array<{
      bankAccountId: string;
      date: string;
      description: string;
      moneyIn: number;
      moneyOut: number;
      accountNumber?: string | null;
      accountName?: string | null;
      province?: string | null;
      taxCodes?: string[];
      provinceTaxCodes?: string[];
      taxMode?: "INCLUSIVE" | "EXCLUSIVE" | "KEEP";
      notes?: string | null;
      externalTransactionId?: string | null;
    }>;
    bankAccountId?: string | null;
  };

  const rows = snapshot.transactions ?? [];
  if (!rows.length) return { ok: false, error: "This save has no transactions." };

  const bankIds = [...new Set(rows.map((r) => r.bankAccountId).filter(Boolean))];
  let targetBankId = snapshot.bankAccountId ?? bankIds[0];
  let bank = targetBankId
    ? await prisma.bankAccount.findFirst({
        where: { id: targetBankId, organizationId },
      })
    : null;

  if (!bank) {
    bank = await prisma.bankAccount.create({
      data: {
        organizationId,
        name: `Restored · ${saved.name}`.slice(0, 120),
        type: "BANK",
        currency: "CAD",
      },
    });
    targetBankId = bank.id;
  }

  if (replace) {
    await prisma.transaction.deleteMany({
      where: { organizationId, bankAccountId: bank.id },
    });
  }

  await prisma.transaction.createMany({
    data: rows.map((row) => ({
      organizationId,
      bankAccountId: bank!.id,
      date: new Date(row.date),
      description: row.description,
      moneyIn: row.moneyIn,
      moneyOut: row.moneyOut,
      accountNumber: row.accountNumber ?? null,
      accountName: row.accountName ?? null,
      province: row.province ?? null,
      taxCodes: row.taxCodes ?? [],
      provinceTaxCodes: row.provinceTaxCodes ?? [],
      taxMode: row.taxMode === "EXCLUSIVE" ? "EXCLUSIVE" : "INCLUSIVE",
      notes: row.notes ?? null,
      externalTransactionId: null,
    })),
  });

  await prisma.userPreference.upsert({
    where: { userId },
    create: {
      userId,
      activeOrganizationId: organizationId,
      activeBankAccountId: bank.id,
    },
    update: { activeBankAccountId: bank.id },
  });

  revalidatePath("/app");
  revalidatePath("/app/folders");

  return {
    ok: true,
    meta: {
      organizationId,
      conversionId: saved.id,
      conversionName: saved.name,
      folderId: saved.folderId,
      folderName: saved.folder.name,
      count: rows.length,
    },
  };
}

export async function loadSavedConversionClientAction(
  formData: FormData,
): Promise<ActionResult & { loadedConversion?: LoadedConversionMeta }> {
  const { organization, session, role } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };

  const id = String(formData.get("id") ?? "");
  const replace = String(formData.get("replace") ?? "") !== "false";
  const result = await loadSavedConversionIntoWorkspace(
    organization.id,
    session.user.id,
    id,
    replace,
  );
  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    message: `Loaded “${result.meta.conversionName}” (${result.meta.count} transactions).`,
    loadedConversion: result.meta,
  };
}

export async function loadSavedConversionAction(formData: FormData): Promise<void> {
  const { organization, session, role } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return;

  const id = String(formData.get("id") ?? "");
  const replace = String(formData.get("replace") ?? "") === "true";
  const result = await loadSavedConversionIntoWorkspace(
    organization.id,
    session.user.id,
    id,
    replace,
  );
  if (!result.ok) return;

  redirect(
    `/app?tab=transactions&loadedConversion=${encodeURIComponent(result.meta.conversionId)}`,
  );
}

export async function updateTransactionCategoryAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { organization, role } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };

  const id = String(formData.get("id") ?? "");
  const existing = await prisma.transaction.findFirst({
    where: { id, organizationId: organization.id },
  });
  if (!existing) return { ok: false, error: "Transaction not found." };

  const accountValue = formData.get("account");
  let accountNumber = existing.accountNumber;
  let accountName = existing.accountName;
  if (accountValue != null) {
    const raw = String(accountValue);
    if (raw === "") {
      accountNumber = null;
      accountName = null;
    } else {
      const [num, ...rest] = raw.split("||");
      accountNumber = num || null;
      accountName = rest.join("||") || null;
    }
  }
  if (formData.has("accountNumber")) {
    accountNumber = String(formData.get("accountNumber") ?? "") || null;
  }

  const taxCodes = formData.has("taxCodes")
    ? String(formData.get("taxCodes") ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : existing.taxCodes;
  const provinceTaxCodes = formData.has("provinceTaxCodes")
    ? String(formData.get("provinceTaxCodes") ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : existing.provinceTaxCodes;
  const taxMode = formData.has("taxMode")
    ? String(formData.get("taxMode") ?? "INCLUSIVE") === "EXCLUSIVE"
      ? "EXCLUSIVE"
      : "INCLUSIVE"
    : existing.taxMode;
  const province = formData.has("province")
    ? String(formData.get("province") ?? "") || null
    : existing.province;
  const notes = formData.has("notes")
    ? String(formData.get("notes") ?? "") || null
    : existing.notes;
  const description = formData.has("description")
    ? String(formData.get("description") ?? existing.description)
    : existing.description;

  // Apply chart defaults when category chosen and no tax selected
  let finalSalesTax = taxCodes;
  let finalProvinceTax = provinceTaxCodes;
  if (accountName && taxCodes.length === 0 && provinceTaxCodes.length === 0) {
    const account = await prisma.chartAccount.findFirst({
      where: {
        organizationId: organization.id,
        OR: [
          ...(accountNumber ? [{ number: accountNumber }] : []),
          { name: accountName },
        ],
      },
    });
    if (account?.defaultGstCode) finalSalesTax = [account.defaultGstCode];
    if (account?.defaultPstCode) finalProvinceTax = [account.defaultPstCode];
  }

  const catalog = await prisma.taxCode.findMany({
    where: { organizationId: organization.id },
    select: { code: true, kind: true },
  });
  const { normalizeTaxCodeAssignment } = await import("@/lib/tax-reports");
  const normalizedTaxes = normalizeTaxCodeAssignment(
    finalSalesTax,
    finalProvinceTax,
    catalog,
  );

  const data: {
    description: string;
    accountNumber: string | null;
    accountName: string | null;
    taxCodes: string[];
    provinceTaxCodes: string[];
    taxMode: "INCLUSIVE" | "EXCLUSIVE";
    province: string | null;
    notes: string | null;
    moneyIn?: number;
    moneyOut?: number;
    date?: Date;
    bankAccountId?: string;
  } = {
    description,
    accountNumber: accountNumber || null,
    accountName,
    taxCodes: normalizedTaxes.taxCodes,
    provinceTaxCodes: normalizedTaxes.provinceTaxCodes,
    taxMode: taxMode as "INCLUSIVE" | "EXCLUSIVE",
    province,
    notes,
  };

  if (formData.has("moneyIn")) {
    data.moneyIn = Math.max(0, Number(formData.get("moneyIn")) || 0);
  }
  if (formData.has("moneyOut")) {
    data.moneyOut = Math.max(0, Number(formData.get("moneyOut")) || 0);
  }
  if (formData.has("date")) {
    const d = String(formData.get("date") ?? "").trim();
    if (d) data.date = new Date(`${d}T12:00:00`);
  }
  if (formData.has("bankAccountId")) {
    const bankAccountId = String(formData.get("bankAccountId") ?? "");
    if (bankAccountId !== existing.bankAccountId) {
      const bank = await prisma.bankAccount.findFirst({
        where: { id: bankAccountId, organizationId: organization.id },
      });
      if (!bank) return { ok: false, error: "Invalid posting account." };
      data.bankAccountId = bank.id;
    }
  }

  const updated = await prisma.transaction.update({
    where: { id },
    data,
    include: { bankAccount: true },
  });

  const inline = formData.get("inline") === "true";
  if (!inline) {
    revalidatePath("/app");
    revalidatePath("/app/gst");
    revalidatePath("/app/pst");
    revalidatePath("/app/general-entries");
  }

  return {
    ok: true,
    message: inline ? undefined : "Category saved.",
    patch: {
      id: updated.id,
      bankAccountId: updated.bankAccountId,
      date: updated.date.toISOString().slice(0, 10),
      description: updated.description,
      moneyIn: Number(updated.moneyIn),
      moneyOut: Number(updated.moneyOut),
      accountNumber: updated.accountNumber,
      accountName: updated.accountName,
      province: updated.province,
      taxCodes: updated.taxCodes,
      provinceTaxCodes: updated.provinceTaxCodes,
      taxMode: updated.taxMode,
      notes: updated.notes,
      bankName: updated.bankAccount.name,
      bankType: updated.bankAccount.type,
    },
  };
}
