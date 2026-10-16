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

/** Per-request dedupe — layout + panes call org context more than once. */
export const ensureOrganizationDefaultsCached = cache((organizationId: string) =>
  ensureOrganizationDefaults(prisma, organizationId),
);

async function organizationDefaultsAlreadyCurrent(
  client: PrismaClient,
  organizationId: string,
): Promise<boolean> {
  const [sampleRule, gst25Rule, taxCodes, txNeedingSplit] = await Promise.all([
    client.rule.findFirst({
      where: { organizationId, name: "Meals - Tim Hortons", isBuiltIn: true },
      select: { accountNumber: true, taxCodes: true },
    }),
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
  if (!sampleRule || sampleRule.accountNumber !== "5150") return false;
  if (sampleRule.taxCodes.includes("GST25")) return false;
  const mealsDefault = DEFAULT_RULES.find((r) => r.name === "Meals - Tim Hortons");
  if (mealsDefault?.taxCodes.includes("GST2.5") && !sampleRule.taxCodes.includes("GST2.5")) {
    return false;
  }
  if (gst25Rule) return false;
  if (txNeedingSplit) {
    const split = splitTaxCodesByKind(txNeedingSplit.taxCodes, taxCodes);
    if (split.provinceTaxCodes.length) return false;
  }
  return true;
}

/**
 * Ensures every organization has starter tax codes, chart of accounts, and rules.
 * Safe to call repeatedly — only fills missing defaults and migrates legacy fields.
 */
export async function ensureOrganizationDefaults(
  client: PrismaClient,
  organizationId: string,
) {
  const [taxCount, accountCount, ruleCount, folderCount] = await Promise.all([
    client.taxCode.count({ where: { organizationId } }),
    client.chartAccount.count({ where: { organizationId } }),
    client.rule.count({ where: { organizationId } }),
    client.folder.count({ where: { organizationId } }),
  ]);

  if (taxCount === 0 && ruleCount === 0 && folderCount === 0) {
    await seedOrganizationDefaults(client, organizationId);
    return { seeded: "full" as const };
  }

  if (
    taxCount > 0 &&
    ruleCount > 0 &&
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

  // Chart accounts: only via Add Small Business Accounts (fillMissingStarterChartAndTaxes).

  // Fill / refresh predefined rules from Canada CSV (once until sample matches)
  const existingRules = await client.rule.findMany({
    where: { organizationId, isBuiltIn: true },
    select: {
      id: true,
      name: true,
      accountNumber: true,
      taxCodes: true,
      provinceTaxCodes: true,
    },
  });
  const ruleByName = new Map(existingRules.map((r) => [r.name, r]));
  const missingRules = DEFAULT_RULES.filter((r) => !ruleByName.has(r.name));
  if (missingRules.length) {
    await client.rule.createMany({
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
  }

  const sampleRule = ruleByName.get("Meals - Tim Hortons");
  const needsRuleRefresh =
    missingRules.length > 20 ||
    !sampleRule ||
    sampleRule.accountNumber !== "5150" ||
    sampleRule.taxCodes.includes("GST25") ||
    (sampleRule.taxCodes.includes("GST2.5") === false &&
      DEFAULT_RULES.find((r) => r.name === "Meals - Tim Hortons")?.taxCodes.includes(
        "GST2.5",
      ));

  if (needsRuleRefresh) {
    for (const rule of DEFAULT_RULES) {
      const existing = ruleByName.get(rule.name);
      if (!existing) continue;
      await client.rule.update({
        where: { id: existing.id },
        data: {
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
        },
      });
    }
  }

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
