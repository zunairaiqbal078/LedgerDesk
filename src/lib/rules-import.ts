import type { ImportMatrix } from "@/lib/import-parser";

export type ImportedRuleDraft = {
  name: string;
  descriptionMatch: string;
  matchType: "CONTAINS" | "STARTS" | "EXACT" | "REGEX";
  appliesTo: "BOTH" | "BANK" | "CREDIT_CARD";
  applyDeposit: boolean;
  applyWithdrawal: boolean;
  accountNumber: string | null;
  accountName: string | null;
  taxCodes: string[];
  provinceTaxCodes: string[];
  taxMode: "INCLUSIVE" | "EXCLUSIVE" | "KEEP";
  active: boolean;
};

function normalizedHeader(header: string) {
  return String(header ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .replace(/[^\w\s/%]/g, "");
}

function ruleImportField(header: string): string {
  const h = normalizedHeader(header);
  const map: Record<string, string> = {
    "rule name": "name",
    rulename: "name",
    name: "name",
    "description match": "descriptionMatch",
    description: "descriptionMatch",
    match: "descriptionMatch",
    "description contains": "descriptionMatch",
    "rule description match": "descriptionMatch",
    descriptionmatch: "descriptionMatch",
    "match type": "matchType",
    matchtype: "matchType",
    "type of match": "matchType",
    "applies to": "appliesTo",
    appliesto: "appliesTo",
    applies: "appliesTo",
    "statement type": "appliesTo",
    "bank credit card": "appliesTo",
    deposit: "deposit",
    "money in": "deposit",
    moneyin: "deposit",
    "deposit money in": "deposit",
    withdrawal: "withdrawal",
    "money out": "withdrawal",
    moneyout: "withdrawal",
    "withdrawal money out": "withdrawal",
    "account number": "accountNumber",
    "account no": "accountNumber",
    "account num": "accountNumber",
    accountnumber: "accountNumber",
    "category account": "account",
    category: "account",
    "account category": "account",
    "account name": "account",
    "category name": "account",
    "category account name": "account",
    "sales tax": "taxes",
    "sales tax code": "taxes",
    "sales tax codes": "taxes",
    "tax code": "taxes",
    "tax codes": "taxes",
    "gst hst": "taxes",
    "gst hst code": "taxes",
    "gst hst codes": "taxes",
    "gst code": "taxes",
    tax: "taxes",
    "pst qst rst": "provinceTaxes",
    "province tax": "provinceTaxes",
    "tax treatment": "taxMode",
    "tax mode": "taxMode",
    "inclusive exclusive": "taxMode",
    "tax inclusive exclusive": "taxMode",
    active: "active",
    enabled: "active",
    status: "active",
  };
  if (map[h]) return map[h];
  if (h.includes("description") && h.includes("match")) return "descriptionMatch";
  if (h.includes("account") && h.includes("number")) return "accountNumber";
  if (h.includes("sales") && h.includes("tax")) return "taxes";
  if ((h.includes("gst") || h.includes("hst")) && h.includes("code")) return "taxes";
  if (h.includes("pst") || h.includes("qst") || h.includes("rst")) return "provinceTaxes";
  if (h.includes("tax") && h.includes("treatment")) return "taxMode";
  return "";
}

function normalizeMatchType(v: string): ImportedRuleDraft["matchType"] {
  const x = String(v || "").trim().toLowerCase();
  if (x.includes("regex") || x.includes("regular")) return "REGEX";
  if (x.includes("start")) return "STARTS";
  if (x.includes("exact") || x === "equals" || x === "equal") return "EXACT";
  return "CONTAINS";
}

function normalizeAppliesTo(v: string): ImportedRuleDraft["appliesTo"] {
  const x = String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  if (!x || x === "both" || x === "all" || x.includes("bank and credit") || x.includes("bank & credit")) {
    return "BOTH";
  }
  if (x.includes("credit") || x === "cc" || x === "card") return "CREDIT_CARD";
  if (x.includes("bank")) return "BANK";
  return "BOTH";
}

function normalizeTaxMode(v: string): ImportedRuleDraft["taxMode"] {
  const x = String(v || "").trim().toLowerCase();
  if (x.startsWith("incl") || ["yes", "included", "gross"].includes(x)) return "INCLUSIVE";
  if (x.startsWith("excl") || ["no", "excluded", "net"].includes(x)) return "EXCLUSIVE";
  return "KEEP";
}

function normalizeActive(v: string | undefined, fallback = true) {
  if (v === undefined || String(v).trim() === "") return fallback;
  const x = String(v).trim().toLowerCase();
  return !["false", "no", "n", "0", "inactive", "disabled", "off"].includes(x);
}

function resolveTaxCodes(
  raw: string,
  catalog: Array<{ code: string; name: string; kind?: string }>,
  kind: "GST_HST" | "PST" | "ANY",
) {
  const requested = String(raw ?? "")
    .split(/[,;+|]/)
    .map((x) => x.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const token of requested) {
    const found = catalog.find(
      (t) =>
        t.code.toLowerCase() === token.toLowerCase() ||
        t.name.toLowerCase() === token.toLowerCase(),
    );
    if (!found || out.includes(found.code)) continue;
    if (kind === "ANY") out.push(found.code);
    else if (kind === "PST" && found.kind === "PST") out.push(found.code);
    else if (kind !== "PST" && found.kind !== "PST") out.push(found.code);
  }
  return out;
}

export function parseRulesFromImportMatrix(
  matrix: ImportMatrix,
  options: {
    taxCodes: Array<{ code: string; name: string; kind?: string }>;
    accounts: Array<{ number: string; name: string }>;
  },
): { rules: ImportedRuleDraft[]; skipped: number; unknownTaxCells: number } {
  if (!matrix.headers.length || !matrix.rows.length) {
    throw new Error("The rules file needs a header row and at least one rule row.");
  }

  const fields = matrix.headers.map(ruleImportField);
  if (!fields.includes("descriptionMatch")) {
    throw new Error(
      'Could not find a Description Match column. Add a heading such as "Description Match" or "Description".',
    );
  }

  let skipped = 0;
  let unknownTaxCells = 0;
  const rules: ImportedRuleDraft[] = [];

  for (const row of matrix.rows) {
    const obj: Record<string, string> = {};
    fields.forEach((field, i) => {
      if (field) obj[field] = String(row[i] ?? "").trim();
    });

    const desc = String(obj.descriptionMatch ?? "").trim();
    if (!desc) {
      skipped += 1;
      continue;
    }

    const rawSales = String(obj.taxes ?? "").trim();
    const rawProvince = String(obj.provinceTaxes ?? "").trim();
    const salesTax = resolveTaxCodes(rawSales, options.taxCodes, "GST_HST");
    const provinceTax = resolveTaxCodes(rawProvince, options.taxCodes, "PST");
    if (rawSales && !salesTax.length) unknownTaxCells += 1;
    if (rawProvince && !provinceTax.length) unknownTaxCells += 1;

    let accountNumber = String(obj.accountNumber ?? "").trim();
    let accountName = String(obj.account ?? "").trim();
    if (accountNumber && !accountName) {
      const a = options.accounts.find(
        (x) => x.number.trim().toLowerCase() === accountNumber.toLowerCase(),
      );
      if (a) accountName = a.name;
    }
    if (accountName && !accountNumber) {
      const a = options.accounts.find(
        (x) => x.name.trim().toLowerCase() === accountName.toLowerCase(),
      );
      if (a) accountNumber = a.number;
    }

    rules.push({
      name: String(obj.name ?? "").trim() || desc.split(",")[0]?.trim() || desc,
      descriptionMatch: desc,
      matchType: normalizeMatchType(obj.matchType ?? ""),
      appliesTo: normalizeAppliesTo(obj.appliesTo ?? ""),
      applyDeposit: normalizeActive(obj.deposit, true),
      applyWithdrawal: normalizeActive(obj.withdrawal, true),
      accountNumber: accountNumber || null,
      accountName: accountName || null,
      taxCodes: salesTax,
      provinceTaxCodes: provinceTax,
      taxMode: normalizeTaxMode(obj.taxMode ?? ""),
      active: normalizeActive(obj.active, true),
    });
  }

  if (!rules.length) {
    throw new Error("No valid rules were found. Each imported rule needs a Description Match value.");
  }

  return { rules, skipped, unknownTaxCells };
}
