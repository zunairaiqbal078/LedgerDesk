/** Sales Tax = GST/HST; Province Tax = PST/QST/RST */
export function taxCategoryLabel(kind: "GST_HST" | "PST" | "OTHER" | "NONE" | string) {
  if (kind === "GST_HST") return "Sales Tax";
  if (kind === "PST") return "Province Tax";
  if (kind === "NONE") return "No Tax";
  return "Other";
}

export function isSalesTaxKind(kind: string) {
  return kind === "GST_HST";
}

export function isProvinceTaxKind(kind: string) {
  return kind === "PST";
}

/** Dropdowns: GST/HST, NONE, and other non-PST codes (matches Transactions bulk edit). */
export function filterSalesTaxPickerOptions<T extends { code: string; kind?: string }>(
  catalog: T[],
): T[] {
  return catalog.filter((t) => {
    const kind = t.kind ?? "";
    if (kind === "PST") return false;
    return !kind || kind === "GST_HST" || kind === "NONE" || kind === "OTHER";
  });
}

/**
 * Dropdowns: PST/QST/RST codes plus NONE (clear province tax), including custom codes
 * added under Tax Codes / used in rules.
 */
export function filterProvinceTaxPickerOptions<T extends { code: string; kind?: string }>(
  catalog: T[],
): T[] {
  return catalog.filter((t) => {
    const kind = t.kind ?? "";
    if (kind === "PST" || kind === "NONE") return true;
    if (kind === "GST_HST") return false;
    return /PST|QST|RST/i.test(t.code);
  });
}

export function splitTaxCodesByKind(
  codes: string[],
  catalog: { code: string; kind: string }[],
) {
  const kindByCode = new Map(catalog.map((t) => [t.code, t.kind]));
  const salesTaxCodes: string[] = [];
  const provinceTaxCodes: string[] = [];
  const other: string[] = [];
  for (const code of codes) {
    const kind = kindByCode.get(code);
    if (kind === "PST") provinceTaxCodes.push(code);
    else if (kind === "GST_HST" || code === "NONE") salesTaxCodes.push(code);
    else if (kind) other.push(code);
    else if (/PST|QST|RST/i.test(code)) provinceTaxCodes.push(code);
    else salesTaxCodes.push(code);
  }
  return { salesTaxCodes, provinceTaxCodes, other };
}
