import type { AppliesTo, MatchType, Rule, TaxMode } from "@prisma/client";

export type RuleLike = Pick<
  Rule,
  | "id"
  | "name"
  | "descriptionMatch"
  | "matchType"
  | "appliesTo"
  | "applyDeposit"
  | "applyWithdrawal"
  | "accountNumber"
  | "accountName"
  | "taxCodes"
  | "provinceTaxCodes"
  | "taxMode"
  | "active"
>;

export type RuleMatchInput = {
  description: string;
  moneyIn: number;
  moneyOut: number;
  statementType: "BANK" | "CREDIT_CARD";
};

export type RuleApplication = {
  ruleId: string;
  ruleName: string;
  accountNumber: string | null;
  accountName: string | null;
  taxCodes: string[];
  provinceTaxCodes: string[];
  taxMode: TaxMode;
};

function normalizeDescription(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

function needlesFromMatch(descriptionMatch: string) {
  return descriptionMatch
    .split(",")
    .map((part) => normalizeDescription(part))
    .filter(Boolean);
}

function matchesNeedle(
  description: string,
  needle: string,
  matchType: MatchType,
): boolean {
  if (!needle) return false;
  switch (matchType) {
    case "STARTS":
      return description.startsWith(needle);
    case "EXACT":
      return description === needle;
    case "REGEX":
      try {
        return new RegExp(needle, "i").test(description);
      } catch {
        return false;
      }
    case "CONTAINS":
    default:
      return description.includes(needle);
  }
}

function statementAllowed(
  appliesTo: AppliesTo,
  statementType: "BANK" | "CREDIT_CARD",
) {
  if (appliesTo === "BOTH") return true;
  if (appliesTo === "BANK") return statementType === "BANK";
  return statementType === "CREDIT_CARD";
}

export function ruleMatches(rule: RuleLike, input: RuleMatchInput): boolean {
  if (!rule.active) return false;
  if (!statementAllowed(rule.appliesTo, input.statementType)) return false;

  const isDeposit = input.moneyIn > 0 && input.moneyOut <= 0;
  const isWithdrawal = input.moneyOut > 0 && input.moneyIn <= 0;
  if (isDeposit && !rule.applyDeposit) return false;
  if (isWithdrawal && !rule.applyWithdrawal) return false;
  if (!isDeposit && !isWithdrawal) {
    // Ambiguous/zero rows: allow if either side enabled
    if (!rule.applyDeposit && !rule.applyWithdrawal) return false;
  }

  const description = normalizeDescription(input.description);
  const needles = needlesFromMatch(rule.descriptionMatch);
  if (needles.length === 0) return false;

  return needles.some((needle) => matchesNeedle(description, needle, rule.matchType));
}

/** First matching active rule wins (caller should sort: custom before built-in if desired). */
export function findMatchingRule(
  rules: RuleLike[],
  input: RuleMatchInput,
): RuleApplication | null {
  for (const rule of rules) {
    if (!ruleMatches(rule, input)) continue;
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      accountNumber: rule.accountNumber,
      accountName: rule.accountName,
      taxCodes: rule.taxCodes,
      provinceTaxCodes: rule.provinceTaxCodes ?? [],
      taxMode: rule.taxMode === "KEEP" ? "INCLUSIVE" : rule.taxMode,
    };
  }
  return null;
}

export function applyRulesToRows<T extends RuleMatchInput>(
  rows: T[],
  rules: RuleLike[],
  options?: { onlyUncategorized?: boolean; getCategory?: (row: T) => string | null | undefined },
): Array<T & { applied?: RuleApplication }> {
  const onlyUncategorized = options?.onlyUncategorized ?? false;
  return rows.map((row) => {
    if (onlyUncategorized) {
      const category = options?.getCategory?.(row);
      if (category && category.trim()) return row;
    }
    const applied = findMatchingRule(rules, row);
    if (!applied) return row;
    return { ...row, applied };
  });
}
