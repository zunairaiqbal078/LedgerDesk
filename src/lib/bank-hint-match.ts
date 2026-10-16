export type BankLike = { id: string; name: string; type: "BANK" | "CREDIT_CARD" };

export type BankHintLike = {
  institutionName: string | null;
  statementType: "BANK" | "CREDIT_CARD" | null;
  accountLast4?: string | null;
};

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|ltd|limited|corp|corporation|the|bank|of|canada)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIASES: Record<string, string[]> = {
  cibc: ["cibc", "canadian imperial"],
  rbc: ["rbc", "royal bank"],
  td: ["td", "toronto dominion", "toronto-dominion"],
  bmo: ["bmo", "bank of montreal"],
  scotiabank: ["scotia", "scotiabank", "bank of nova scotia"],
  atb: ["atb", "alberta treasury"],
  amex: ["amex", "american express"],
  national: ["national bank", "banque nationale"],
};

function aliasKeys(name: string): string[] {
  const n = normalizeName(name);
  const hits: string[] = [];
  for (const [key, list] of Object.entries(ALIASES)) {
    if (list.some((a) => n.includes(a) || a.includes(n))) hits.push(key);
  }
  return hits;
}

/** Match AI bank hint to an existing org bank, or suggest creating one. */
export function resolveBankFromHint(
  banks: BankLike[],
  hint: BankHintLike | null | undefined,
):
  | { mode: "existing"; bankId: string }
  | { mode: "new"; name: string; type: "BANK" | "CREDIT_CARD" }
  | null {
  if (!hint?.institutionName?.trim()) return null;
  const hintName = hint.institutionName.trim();
  const hintNorm = normalizeName(hintName);
  const hintAliases = aliasKeys(hintName);
  const preferredType = hint.statementType;

  let best: { id: string; score: number } | null = null;
  for (const bank of banks) {
    if (preferredType && bank.type !== preferredType) continue;
    const bankNorm = normalizeName(bank.name);
    let score = 0;
    if (bankNorm === hintNorm) score = 100;
    else if (bankNorm.includes(hintNorm) || hintNorm.includes(bankNorm)) score = 80;
    else {
      const bankAliases = aliasKeys(bank.name);
      if (hintAliases.some((a) => bankAliases.includes(a))) score = 70;
      else if (hint.accountLast4 && bank.name.includes(hint.accountLast4)) score = 60;
    }
    if (score && (!best || score > best.score)) best = { id: bank.id, score };
  }

  // Retry without type filter if nothing matched
  if (!best && preferredType) {
    return resolveBankFromHint(
      banks,
      { ...hint, statementType: null },
    );
  }

  if (best && best.score >= 60) {
    return { mode: "existing", bankId: best.id };
  }

  const suffix = hint.accountLast4 ? ` …${hint.accountLast4}` : "";
  return {
    mode: "new",
    name: `${hintName}${suffix}`.slice(0, 120),
    type: preferredType ?? "BANK",
  };
}
