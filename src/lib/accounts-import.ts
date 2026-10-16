import type { ImportMatrix } from "@/lib/import-parser";

export type ImportedAccountDraft = {
  number: string;
  name: string;
  type: "INCOME" | "EXPENSE" | "ASSET" | "LIABILITY" | "EQUITY";
  defaultGstCode: string | null;
  defaultPstCode: string | null;
};

function normalizedHeader(header: string) {
  return String(header ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .replace(/[^\w\s/%]/g, "");
}

function accountImportField(header: string): string {
  const h = normalizedHeader(header);
  const map: Record<string, string> = {
    number: "number",
    "account number": "number",
    "account no": "number",
    "acct number": "number",
    "acct no": "number",
    code: "number",
    name: "name",
    "account name": "name",
    "category name": "name",
    category: "name",
    "account category": "name",
    type: "type",
    "account type": "type",
    gst: "gst",
    "default gst": "gst",
    "default gst hst": "gst",
    "gst hst": "gst",
    pst: "pst",
    "default pst": "pst",
    "pst qst rst": "pst",
    "province tax": "pst",
  };
  if (map[h]) return map[h];
  if (h.includes("account") && h.includes("number")) return "number";
  if (h.includes("category") && h.includes("name")) return "name";
  if (h.includes("gst")) return "gst";
  if (h.includes("pst") || h.includes("qst") || h.includes("rst")) return "pst";
  return "";
}

function normalizeType(raw: string): ImportedAccountDraft["type"] {
  const t = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (t.startsWith("INC")) return "INCOME";
  if (t.startsWith("EXP")) return "EXPENSE";
  if (t.startsWith("ASS")) return "ASSET";
  if (t.startsWith("LIA") || t.includes("LIABILITY")) return "LIABILITY";
  if (t.startsWith("EQU")) return "EQUITY";
  if (["INCOME", "EXPENSE", "ASSET", "LIABILITY", "EQUITY"].includes(t)) {
    return t as ImportedAccountDraft["type"];
  }
  return "EXPENSE";
}

export function parseAccountsFromImportMatrix(matrix: ImportMatrix): {
  accounts: ImportedAccountDraft[];
  skipped: number;
} {
  if (!matrix.headers.length || !matrix.rows.length) {
    throw new Error("The accounts file needs a header row and at least one account row.");
  }

  const fields = matrix.headers.map(accountImportField);
  if (!fields.includes("number") && !fields.includes("name")) {
    throw new Error(
      'Could not find Account Number or Name columns. Use headings like "Account Number" and "Account Name".',
    );
  }

  let skipped = 0;
  const accounts: ImportedAccountDraft[] = [];

  for (const row of matrix.rows) {
    const obj: Record<string, string> = {};
    fields.forEach((field, i) => {
      if (field) obj[field] = String(row[i] ?? "").trim();
    });

    const number = String(obj.number ?? "").trim();
    const name = String(obj.name ?? "").trim();
    if (!number && !name) {
      skipped += 1;
      continue;
    }
    if (!number || !name) {
      skipped += 1;
      continue;
    }

    accounts.push({
      number,
      name,
      type: normalizeType(obj.type ?? ""),
      defaultGstCode: String(obj.gst ?? "").trim() || null,
      defaultPstCode: String(obj.pst ?? "").trim() || null,
    });
  }

  if (!accounts.length) {
    throw new Error("No valid accounts found. Each row needs an account number and name.");
  }

  return { accounts, skipped };
}
