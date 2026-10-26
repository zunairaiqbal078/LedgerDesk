"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateAutomaticEntries } from "@/lib/general-entries";
import { canEditTransactions } from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";
import {
  findTransferCandidates,
  uniqueTransferCandidates,
} from "@/lib/transfer-matching";

export type ActionResult = {
  ok: boolean;
  error?: string;
  message?: string;
  count?: number;
};

export async function confirmTransferAction(formData: FormData): Promise<void> {
  const { organization, role, session } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return;

  const outId = String(formData.get("outId") ?? "");
  const inId = String(formData.get("inId") ?? "");

  const [outTx, inTx] = await Promise.all([
    prisma.transaction.findFirst({
      where: { id: outId, organizationId: organization.id },
      include: { bankAccount: true },
    }),
    prisma.transaction.findFirst({
      where: { id: inId, organizationId: organization.id },
      include: { bankAccount: true },
    }),
  ]);

  if (!outTx || !inTx) return;
  if (outTx.transferMatchId || inTx.transferMatchId) return;
  if (outTx.bankAccountId === inTx.bankAccountId) return;

  const amount = Number(outTx.moneyOut);
  if (Math.abs(amount - Number(inTx.moneyIn)) > 0.001) return;

  const match = await prisma.transferMatch.create({
    data: {
      organizationId: organization.id,
      amount,
      fromTransactionId: outTx.id,
      toTransactionId: inTx.id,
    },
  });

  await prisma.transaction.update({
    where: { id: outTx.id },
    data: {
      transferMatchId: match.id,
      transferCounterpartId: inTx.id,
      accountNumber: null,
      accountName: `Transfer to ${inTx.bankAccount.name}`,
      taxCodes: [],
    },
  });
  await prisma.transaction.update({
    where: { id: inTx.id },
    data: {
      transferMatchId: match.id,
      transferCounterpartId: outTx.id,
      accountNumber: null,
      accountName: `Transfer from ${outTx.bankAccount.name}`,
      taxCodes: [],
    },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      actorId: session.user.id,
      action: "transfer.confirmed",
      entityType: "TransferMatch",
      entityId: match.id,
      metadata: { amount },
    },
  });

  revalidatePath("/app/transfers");
  revalidatePath("/app");
  revalidatePath("/app/gst");
  revalidatePath("/app/pst");
}

export async function unmatchTransferAction(formData: FormData): Promise<void> {
  const { organization, role } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return;
  const matchId = String(formData.get("matchId") ?? "");

  const match = await prisma.transferMatch.findFirst({
    where: { id: matchId, organizationId: organization.id },
  });
  if (!match) return;

  await prisma.transaction.updateMany({
    where: {
      organizationId: organization.id,
      transferMatchId: matchId,
    },
    data: {
      transferMatchId: null,
      transferCounterpartId: null,
      accountName: null,
      accountNumber: null,
    },
  });
  await prisma.transferMatch.delete({ where: { id: matchId } });

  revalidatePath("/app/transfers");
  revalidatePath("/app");
}

export async function autoMatchTransfersAction(formData: FormData): Promise<void> {
  const { organization, role } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return;
  const windowDays = Number(formData.get("windowDays") ?? 7);

  const txs = await prisma.transaction.findMany({
    where: { organizationId: organization.id, transferMatchId: null },
  });

  const candidates = uniqueTransferCandidates(
    findTransferCandidates(
      txs.map((tx) => ({
        id: tx.id,
        date: tx.date,
        description: tx.description,
        moneyIn: Number(tx.moneyIn),
        moneyOut: Number(tx.moneyOut),
        bankAccountId: tx.bankAccountId,
        transferMatchId: tx.transferMatchId,
      })),
      windowDays,
    ),
  );

  for (const candidate of candidates) {
    const fd = new FormData();
    fd.set("outId", candidate.outId);
    fd.set("inId", candidate.inId);
    await confirmTransferAction(fd);
  }
}

const reconSchema = z.object({
  endDate: z.string().min(8),
  openingBalance: z.coerce.number(),
  statementEndingBalance: z.coerce.number(),
  clearedInIds: z.string().default(""),
  clearedOutIds: z.string().default(""),
  status: z.enum(["DRAFT", "FINISHED"]),
  reconciliationId: z.string().optional(),
});

export async function saveReconciliationAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { organization, activeBankId, role, session } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };
  if (!activeBankId) return { ok: false, error: "Select a bank first." };

  const parsed = reconSchema.safeParse({
    endDate: formData.get("endDate"),
    openingBalance: formData.get("openingBalance"),
    statementEndingBalance: formData.get("statementEndingBalance"),
    clearedInIds: formData.get("clearedInIds") ?? "",
    clearedOutIds: formData.get("clearedOutIds") ?? "",
    status: formData.get("status") ?? "DRAFT",
    reconciliationId: formData.get("reconciliationId") || undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid reconciliation data." };

  const clearedInIds = parsed.data.clearedInIds.split(",").filter(Boolean);
  const clearedOutIds = parsed.data.clearedOutIds.split(",").filter(Boolean);

  const txs = await prisma.transaction.findMany({
    where: {
      organizationId: organization.id,
      bankAccountId: activeBankId,
      id: { in: [...clearedInIds, ...clearedOutIds] },
    },
  });

  const moneyIn = txs
    .filter((t) => clearedInIds.includes(t.id))
    .reduce((s, t) => s + Number(t.moneyIn), 0);
  const moneyOut = txs
    .filter((t) => clearedOutIds.includes(t.id))
    .reduce((s, t) => s + Number(t.moneyOut), 0);

  const bank = await prisma.bankAccount.findFirst({
    where: { id: activeBankId, organizationId: organization.id },
  });
  if (!bank) return { ok: false, error: "Bank not found." };

  // Bank: opening + in − out. Credit card: opening + out − in (matches statement converter).
  const calculatedEnding =
    bank.type === "CREDIT_CARD"
      ? parsed.data.openingBalance + moneyOut - moneyIn
      : parsed.data.openingBalance + moneyIn - moneyOut;
  const difference = parsed.data.statementEndingBalance - calculatedEnding;

  const data = {
    organizationId: organization.id,
    bankAccountId: activeBankId,
    status: parsed.data.status,
    endDate: new Date(parsed.data.endDate),
    openingBalance: parsed.data.openingBalance,
    statementEndingBalance: parsed.data.statementEndingBalance,
    calculatedEndingBalance: calculatedEnding,
    moneyIn,
    moneyOut,
    difference,
    clearedInIds,
    clearedOutIds,
  };

  let reconId = parsed.data.reconciliationId;
  if (reconId) {
    const existing = await prisma.reconciliation.findFirst({
      where: { id: reconId, organizationId: organization.id },
    });
    if (!existing) return { ok: false, error: "Reconciliation not found." };
    if (existing.status === "FINISHED") {
      return { ok: false, error: "Finished reconciliations cannot be overwritten. Undo first." };
    }
    await prisma.reconciliation.update({ where: { id: reconId }, data });
  } else {
    const created = await prisma.reconciliation.create({ data });
    reconId = created.id;
  }

  if (parsed.data.status === "FINISHED") {
    await prisma.transaction.updateMany({
      where: { id: { in: clearedInIds }, organizationId: organization.id },
      data: {
        reconciledIn: true,
        reconciliationInId: reconId,
      },
    });
    await prisma.transaction.updateMany({
      where: { id: { in: clearedOutIds }, organizationId: organization.id },
      data: {
        reconciledOut: true,
        reconciliationOutId: reconId,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      actorId: session.user.id,
      action:
        parsed.data.status === "FINISHED"
          ? "reconciliation.finished"
          : "reconciliation.draft_saved",
      entityType: "Reconciliation",
      entityId: reconId,
      metadata: { difference, bank: bank.name },
    },
  });

  revalidatePath("/app/reconciliation");
  revalidatePath("/app");
  return {
    ok: true,
    message:
      parsed.data.status === "FINISHED"
        ? "Reconciliation finished."
        : "Draft saved.",
  };
}

export async function undoReconciliationAction(formData: FormData): Promise<ActionResult> {
  const { organization, role } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };
  const id = String(formData.get("id") ?? "");

  const recon = await prisma.reconciliation.findFirst({
    where: { id, organizationId: organization.id },
  });
  if (!recon) return { ok: false, error: "Not found." };

  await prisma.transaction.updateMany({
    where: {
      organizationId: organization.id,
      OR: [{ reconciliationInId: id }, { reconciliationOutId: id }],
    },
    data: {
      reconciledIn: false,
      reconciledOut: false,
      reconciliationInId: null,
      reconciliationOutId: null,
    },
  });

  await prisma.reconciliation.update({
    where: { id },
    data: { status: "UNDONE", undoneAt: new Date() },
  });

  revalidatePath("/app/reconciliation");
  revalidatePath("/app");
  return { ok: true, message: "Reconciliation undone." };
}

export async function generateGeneralEntriesAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { organization, role, session } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };

  const periodType = String(formData.get("periodType") ?? "MONTHLY") as
    | "MONTHLY"
    | "QUARTERLY"
    | "YEARLY"
    | "CUSTOM";

  if (!["MONTHLY", "QUARTERLY", "YEARLY", "CUSTOM"].includes(periodType)) {
    return { ok: false, error: "Invalid period type." };
  }

  const customStartRaw = String(formData.get("customStartDate") ?? "").trim();
  const customEndRaw = String(formData.get("customEndDate") ?? "").trim();
  const customStart = customStartRaw ? new Date(customStartRaw) : null;
  const customEnd = customEndRaw ? new Date(customEndRaw) : null;

  if (periodType === "CUSTOM") {
    if (
      !customStart ||
      !customEnd ||
      Number.isNaN(customStart.getTime()) ||
      Number.isNaN(customEnd.getTime()) ||
      customStart > customEnd
    ) {
      return {
        ok: false,
        error: "Choose a valid Custom Start Date and Custom End Date before generating.",
      };
    }
  }

  const fiscalStartMonth = Math.min(
    12,
    Math.max(1, Number(formData.get("fiscalStartMonth")) || organization.fiscalYearStartMonth || 1),
  );
  const fiscalStartDay = Math.min(
    28,
    Math.max(1, Number(formData.get("fiscalStartDay")) || organization.fiscalYearStartDay || 1),
  );

  const parseTaxAccount = (raw: string) => {
    const value = raw.trim();
    if (!value) return null;
    const [number, ...rest] = value.split("||");
    const name = rest.join("||").trim();
    if (!name && !number) return null;
    return { number: number || null, name: name || number || "Tax account" };
  };

  const inputTaxAccount = parseTaxAccount(String(formData.get("inputTaxAccount") ?? ""));
  const outputTaxAccount = parseTaxAccount(String(formData.get("outputTaxAccount") ?? ""));

  await prisma.organization.update({
    where: { id: organization.id },
    data: {
      fiscalYearStartMonth: fiscalStartMonth,
      fiscalYearStartDay: fiscalStartDay,
    },
  });

  const [transactions, taxCodes] = await Promise.all([
    prisma.transaction.findMany({
      where: { organizationId: organization.id },
      include: { bankAccount: true },
      orderBy: { date: "asc" },
    }),
    prisma.taxCode.findMany({ where: { organizationId: organization.id } }),
  ]);

  const rateMap = new Map(taxCodes.map((t) => [t.code, Number(t.rate)]));
  const generated = generateAutomaticEntries(
    transactions.map((tx) => ({
      id: tx.id,
      date: tx.date,
      description: tx.description,
      moneyIn: Number(tx.moneyIn),
      moneyOut: Number(tx.moneyOut),
      accountNumber: tx.accountNumber,
      accountName: tx.accountName,
      taxCodes: tx.taxCodes,
      taxMode: tx.taxMode,
      transferMatchId: tx.transferMatchId,
      bankAccountId: tx.bankAccountId,
      bankName: tx.bankAccount.name,
      bankType: tx.bankAccount.type,
    })),
    {
      periodType,
      taxRateByCode: rateMap,
      customStart,
      customEnd,
      inputTaxAccount,
      outputTaxAccount,
    },
  );

  // Replace previous automatic entries
  await prisma.generalEntry.deleteMany({
    where: { organizationId: organization.id, source: "AUTOMATIC" },
  });

  for (const entry of generated) {
    await prisma.generalEntry.create({
      data: {
        organizationId: organization.id,
        date: entry.date,
        memo: entry.memo,
        periodLabel: entry.periodLabel,
        source: "AUTOMATIC",
        lines: {
          create: entry.lines.map((line) => ({
            accountNumber: line.accountNumber,
            accountName: line.accountName,
            memo: line.memo,
            debit: line.debit,
            credit: line.credit,
          })),
        },
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      actorId: session.user.id,
      action: "general_entries.generated",
      entityType: "GeneralEntry",
      metadata: { count: generated.length, periodType },
    },
  });

  revalidatePath("/app/general-entries");
  return {
    ok: true,
    count: generated.length,
    message: `Generated ${generated.length} automatic entries.`,
  };
}

export async function createManualGeneralEntryAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { organization, role } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };

  const date = String(formData.get("date") ?? "");
  const memo = String(formData.get("memo") ?? "");
  const linesRaw = String(formData.get("lines") ?? "[]");

  let lines: Array<{
    accountNumber?: string;
    accountName: string;
    memo?: string;
    debit: number;
    credit: number;
  }>;
  try {
    lines = JSON.parse(linesRaw);
  } catch {
    return { ok: false, error: "Invalid lines payload." };
  }

  if (!date || lines.length < 2) {
    return { ok: false, error: "Need a date and at least two lines." };
  }

  const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  if (Math.abs(debit - credit) > 0.02) {
    return { ok: false, error: "Entry is not balanced." };
  }

  await prisma.generalEntry.create({
    data: {
      organizationId: organization.id,
      date: new Date(date),
      memo,
      source: "MANUAL",
      lines: {
        create: lines.map((line) => ({
          accountNumber: line.accountNumber || null,
          accountName: line.accountName,
          memo: line.memo || null,
          debit: Number(line.debit || 0),
          credit: Number(line.credit || 0),
        })),
      },
    },
  });

  revalidatePath("/app/general-entries");
  return { ok: true, message: "Manual entry created." };
}

export async function deleteGeneralEntryAction(formData: FormData): Promise<void> {
  const { organization } = await requireOrgContext("BOOKKEEPER");
  const id = String(formData.get("id") ?? "");
  await prisma.generalEntry.deleteMany({
    where: { id, organizationId: organization.id },
  });
  revalidatePath("/app/general-entries");
  revalidatePath("/app");
}

export async function bulkDeleteGeneralEntriesAction(
  formData: FormData,
): Promise<ActionResult> {
  const { organization, role } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };
  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!ids.length) return { ok: false, error: "Select entries first." };

  const result = await prisma.generalEntry.deleteMany({
    where: { id: { in: ids }, organizationId: organization.id },
  });
  revalidatePath("/app/general-entries");
  revalidatePath("/app");
  return { ok: true, count: result.count, message: `Deleted ${result.count} entries.` };
}

export async function deleteReconciliationAction(
  formData: FormData,
): Promise<ActionResult> {
  const { organization, role } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };
  const id = String(formData.get("id") ?? "");
  const existing = await prisma.reconciliation.findFirst({
    where: { id, organizationId: organization.id },
  });
  if (!existing) return { ok: false, error: "Reconciliation not found." };
  if (existing.status === "FINISHED") {
    return {
      ok: false,
      error: "Undo the finished reconciliation before deleting it.",
    };
  }
  await prisma.reconciliation.delete({ where: { id: existing.id } });
  revalidatePath("/app/reconciliation");
  revalidatePath("/app");
  return { ok: true, message: "Reconciliation deleted." };
}

export async function bulkDeleteReconciliationsAction(
  formData: FormData,
): Promise<ActionResult> {
  const { organization, role } = await requireOrgContext("BOOKKEEPER");
  if (!canEditTransactions(role)) return { ok: false, error: "Forbidden" };
  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!ids.length) return { ok: false, error: "Select reconciliations first." };

  const result = await prisma.reconciliation.deleteMany({
    where: {
      id: { in: ids },
      organizationId: organization.id,
      status: { not: "FINISHED" },
    },
  });
  revalidatePath("/app/reconciliation");
  revalidatePath("/app");
  return {
    ok: true,
    count: result.count,
    message: `Deleted ${result.count} reconciliation record${result.count === 1 ? "" : "s"}.`,
  };
}
