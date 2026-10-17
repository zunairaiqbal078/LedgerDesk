import { cache } from "react";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  DEFAULT_CHART_ACCOUNTS,
  DEFAULT_RULES,
  DEFAULT_TAX_CODES,
  seedOrganizationDefaults,
  splitTaxCodesByKind,
} from "@/lib/org-defaults";
import {
  getOrganizationStarterRulesVisible,
  setOrganizationStarterRulesVisible,
} from "@/lib/org-meta";

/** Per-request dedupe — layout + panes call org context more than once. */
export const ensureOrganizationDefaultsCached = cache((organizationId: string) =>
  ensureOrganizationDefaults(prisma, organizationId),
);

async function organizationDefaultsAlreadyCurrent(
  client: PrismaClient,
  organizationId: string,
): Promise<boolean> {
  const [gst25Rule, taxCodes, txNeedingSplit] = await Promise.all([
    client.rule.findFirst({
      where: { organizationId, taxCodes: { has: "GST25" } },
      select: { id: true },
    }),
    client.taxCode.findMany({
      where: { organizationId },
      select: { code: true, kind: true },
    }),
    client.transaction.findFirst({
      where: {
        organizationId,
        provinceTaxCodes: { isEmpty: true },
        NOT: { taxCodes: { equals: [] } },
      },
      select: { taxCodes: true },
    }),
  ]);

  const taxSet = new Set(taxCodes.map((t) => t.code));
  if (DEFAULT_TAX_CODES.some((t) => !taxSet.has(t.code))) return false;
  if (gst25Rule) return false;
  if (txNeedingSplit) {
    const split = splitTaxCodesByKind(txNeedingSplit.taxCodes, taxCodes);
    if (split.provinceTaxCodes.length) return false;
  }
  return true;
}

/**
 * Ensures every organization has starter tax codes and a General folder.
 * Predefined rules / chart accounts are opt-in via toolbar buttons (not auto-seeded).
 */
export async function ensureOrganizationDefaults(
  client: PrismaClient,
  organizationId: string,
) {
  const [taxCount, ruleCount, folderCount, builtInRuleCount] = await Promise.all([
    client.taxCode.count({ where: { organizationId } }),
    client.rule.count({ where: { organizationId } }),
    client.folder.count({ where: { organizationId } }),
    client.rule.count({ where: { organizationId, isBuiltIn: true } }),
  ]);

  // Existing orgs that already had auto-seeded rules: keep them listed until user deletes them.
  if (builtInRuleCount > 0) {
    const visible = await getOrganizationStarterRulesVisible(organizationId);
    if (!visible) {
      await setOrganizationStarterRulesVisible(organizationId, true);
    }
  }

  if (taxCount === 0 && ruleCount === 0 && folderCount === 0) {
    await seedOrganizationDefaults(client, organizationId);
    return { seeded: "full" as const };
  }

  if (
    taxCount > 0 &&
    folderCount > 0 &&
    (await organizationDefaultsAlreadyCurrent(client, organizationId))
  ) {
    return { seeded: "partial" as const };
  }

  // Always fill missing tax codes (e.g. GST2.5, province taxes)
  const existingTaxes = await client.taxCode.findMany({
    where: { organizationId },
    select: { code: true },
  });
  const taxCodes = new Set(existingTaxes.map((t) => t.code));
  const missingTaxes = DEFAULT_TAX_CODES.filter((t) => !taxCodes.has(t.code));
  if (missingTaxes.length) {
    await client.taxCode.createMany({
      data: missingTaxes.map((tax) => ({
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
  }

  // Chart accounts: only via Add Small Business Accounts.
  // Rules: only via Add predefined rules (fillMissingPredefinedRules).

  // Migrate GST25 references → GST2.5 on rules
  await client.$executeRaw`
    UPDATE "Rule"
    SET "taxCodes" = array_replace("taxCodes", 'GST25', 'GST2.5')
    WHERE "organizationId" = ${organizationId}
      AND 'GST25' = ANY("taxCodes")
  `;

  // Split any PST codes that were stored in taxCodes into provinceTaxCodes
  const catalog = await client.taxCode.findMany({
    where: { organizationId },
    select: { code: true, kind: true },
  });
  const rulesNeedingSplit = await client.rule.findMany({
    where: {
      organizationId,
      taxCodes: { isEmpty: false },
    },
    select: { id: true, taxCodes: true, provinceTaxCodes: true },
  });
  for (const rule of rulesNeedingSplit) {
    const split = splitTaxCodesByKind(rule.taxCodes, catalog);
    if (!split.provinceTaxCodes.length) continue;
    const already = new Set(rule.provinceTaxCodes);
    const mergedProvince = [
      ...rule.provinceTaxCodes,
      ...split.provinceTaxCodes.filter((c) => !already.has(c)),
    ];
    const salesOnly = split.salesTaxCodes;
    if (
      mergedProvince.length !== rule.provinceTaxCodes.length ||
      salesOnly.join("|") !== rule.taxCodes.join("|")
    ) {
      await client.rule.update({
        where: { id: rule.id },
        data: {
          taxCodes: salesOnly,
          provinceTaxCodes: mergedProvince,
        },
      });
    }
  }

  const txsNeedingSplit = await client.transaction.findMany({
    where: {
      organizationId,
      taxCodes: { isEmpty: false },
      provinceTaxCodes: { isEmpty: true },
    },
    select: { id: true, taxCodes: true },
    take: 2000,
  });
  for (const tx of txsNeedingSplit) {
    const split = splitTaxCodesByKind(tx.taxCodes, catalog);
    if (!split.provinceTaxCodes.length) continue;
    await client.transaction.update({
      where: { id: tx.id },
      data: {
        taxCodes: split.salesTaxCodes,
        provinceTaxCodes: split.provinceTaxCodes,
      },
    });
  }

  if (folderCount === 0) {
    await client.folder.create({
      data: { organizationId, name: "General" },
    });
  }

  return { seeded: "partial" as const };
}

/**
 * Always fills missing starter tax codes and chart accounts (by account number).
 * Used by “Add Small Business Accounts” — not skipped when org defaults are “already current”.
 */
export async function fillMissingStarterChartAndTaxes(
  client: PrismaClient,
  organizationId: string,
): Promise<{ accountsAdded: number; taxesAdded: number }> {
  let taxesAdded = 0;
  let accountsAdded = 0;

  const existingTaxes = await client.taxCode.findMany({
    where: { organizationId },
    select: { code: true },
  });
  const taxCodes = new Set(existingTaxes.map((t) => t.code));
  const missingTaxes = DEFAULT_TAX_CODES.filter((t) => !taxCodes.has(t.code));
  if (missingTaxes.length) {
    const result = await client.taxCode.createMany({
      data: missingTaxes.map((tax) => ({
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
    taxesAdded = result.count;
  }

  const existingAccounts = await client.chartAccount.findMany({
    where: { organizationId },
    select: { id: true, number: true, isSystem: true, name: true },
  });
  const accountByNumber = new Map(existingAccounts.map((a) => [a.number, a]));
  const missingAccounts = DEFAULT_CHART_ACCOUNTS.filter((a) => !accountByNumber.has(a.number));
  if (missingAccounts.length) {
    const result = await client.chartAccount.createMany({
      data: missingAccounts.map((account) => ({
        organizationId,
        number: account.number,
        name: account.name,
        type: account.type,
        defaultGstCode: account.defaultGstCode,
        defaultPstCode: account.defaultPstCode,
        isSystem: true,
      })),
      skipDuplicates: true,
    });
    accountsAdded = result.count;
  }

  const mealsAccount = accountByNumber.get("5150");
  const needsAccountRefresh =
    missingAccounts.length > 0 ||
    !mealsAccount ||
    mealsAccount.name !== "Meals & Entertainment";
  if (needsAccountRefresh) {
    for (const account of DEFAULT_CHART_ACCOUNTS) {
      const existing = accountByNumber.get(account.number);
      if (!existing?.isSystem) continue;
      await client.chartAccount.update({
        where: { id: existing.id },
        data: {
          name: account.name,
          type: account.type,
          defaultGstCode: account.defaultGstCode,
          defaultPstCode: account.defaultPstCode,
        },
      });
    }
  }

  return { accountsAdded, taxesAdded };
}

/**
 * Adds missing predefined Canada rules for this client (by rule name).
 * Does not recreate rules the user already deleted (same name gone = re-addable).
 */
export async function fillMissingPredefinedRules(
  client: PrismaClient,
  organizationId: string,
): Promise<{ rulesAdded: number }> {
  // Ensure tax codes exist so rule tax dropdowns resolve
  const existingTaxes = await client.taxCode.findMany({
    where: { organizationId },
    select: { code: true },
  });
  const taxCodes = new Set(existingTaxes.map((t) => t.code));
  const missingTaxes = DEFAULT_TAX_CODES.filter((t) => !taxCodes.has(t.code));
  if (missingTaxes.length) {
    await client.taxCode.createMany({
      data: missingTaxes.map((tax) => ({
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
  }

  const existingRules = await client.rule.findMany({
    where: { organizationId },
    select: { name: true },
  });
  const existingNames = new Set(existingRules.map((r) => r.name));
  const missingRules = DEFAULT_RULES.filter((r) => !existingNames.has(r.name));
  if (!missingRules.length) return { rulesAdded: 0 };

  const result = await client.rule.createMany({
    data: missingRules.map((rule) => ({
      organizationId,
      name: rule.name,
      descriptionMatch: rule.descriptionMatch,
      matchType: rule.matchType,
      appliesTo: rule.appliesTo,
      applyDeposit: rule.applyDeposit,
      applyWithdrawal: rule.applyWithdrawal,
      accountNumber: rule.accountNumber,
      accountName: rule.accountName,
      taxCodes: [...rule.taxCodes],
      provinceTaxCodes: [...rule.provinceTaxCodes],
      taxMode: rule.taxMode,
      active: rule.active,
      isBuiltIn: true,
    })),
  });

  return { rulesAdded: result.count };
}
