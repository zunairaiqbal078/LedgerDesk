import type { ImportMatrix } from "@/lib/import-parser";

export type ImportedTaxCodeDraft = {
  code: string;
  name: string;
  rate: number;
  kind: "GST_HST" | "PST" | "OTHER" | "NONE";
  province: string | null;
};

function normalizedHeader(header: string) {
  return String(header ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .replace(/[^\w\s/%]/g, "");
}

function taxImportField(header: string): string {
  const h = normalizedHeader(header);
  const map: Record<string, string> = {
    code: "code",
    "tax code": "code",
    "sales tax code": "code",
    name: "name",
    description: "name",
    "tax name": "name",
    rate: "rate",
    "rate percent": "rate",
    "rate %": "rate",
    percent: "rate",
    kind: "kind",
    type: "kind",
    "tax type": "kind",
    category: "kind",
    "gst hst": "kind",
    province: "province",
    "province code": "province",
    territory: "province",
  };
  if (map[h]) return map[h];
  if (h.includes("tax") && h.includes("code")) return "code";
  if (h.includes("rate")) return "rate";
  if (h.includes("province") || h.includes("territory")) return "province";
  if (h.includes("type") || h.includes("kind")) return "kind";
  return "";
}

function normalizeKind(raw: string): ImportedTaxCodeDraft["kind"] {
  const v = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/\//g, "_");
  if (!v) return "GST_HST";
  if (v.includes("NONE") || v.includes("NO_TAX") || v === "ZERO") return "NONE";
  if (v.includes("PST") || v.includes("QST") || v.includes("RST")) return "PST";
  if (v.includes("OTHER")) return "OTHER";
  if (v.includes("GST") || v.includes("HST")) return "GST_HST";
  if (["GST_HST", "PST", "OTHER", "NONE"].includes(v)) return v as ImportedTaxCodeDraft["kind"];
  return "GST_HST";
}

function parseRate(raw: string) {
  const n = Number.parseFloat(String(raw ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function parseTaxCodesFromImportMatrix(matrix: ImportMatrix): {
  codes: ImportedTaxCodeDraft[];
  skipped: number;
} {
  if (!matrix.headers.length || !matrix.rows.length) {
    throw new Error("The tax file needs a header row and at least one data row.");
  }

  const fields = matrix.headers.map(taxImportField);
  if (!fields.includes("code") && !fields.includes("name")) {
    throw new Error('Could not find Code or Name columns. Use headings like "Code" and "Name".');
  }

  let skipped = 0;
  const codes: ImportedTaxCodeDraft[] = [];

  for (const row of matrix.rows) {
    const obj: Record<string, string> = {};
    fields.forEach((field, i) => {
      if (field) obj[field] = String(row[i] ?? "").trim();
    });

    const code = String(obj.code ?? "").trim();
    const name = String(obj.name ?? "").trim() || code;
    if (!code && !name) {
      skipped += 1;
      continue;
    }
    if (!code) {
      skipped += 1;
      continue;
    }

    codes.push({
      code,
      name: name || code,
      rate: parseRate(obj.rate ?? ""),
      kind: normalizeKind(obj.kind ?? ""),
      province: String(obj.province ?? "").trim().toUpperCase() || null,
    });
  }

  if (!codes.length) {
    throw new Error("No valid tax codes found. Each row needs at least a Code value.");
  }

  return { codes, skipped };
}
