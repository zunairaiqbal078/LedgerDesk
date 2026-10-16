import { parseDate, parseMoney, type ParsedImportRow } from "@/lib/import-parser";

const DATE_CAPTURE =
  /(\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})/;
const DATE_RE = new RegExp(DATE_CAPTURE.source);
const DATE_GLOBAL = new RegExp(DATE_CAPTURE.source, "g");
const AMOUNT_RE =
  /(?:CAD|USD|CDN\$|\$)?\s*(-?\(?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\)?(?:\s*(?:CR|DR))?|-?\d+\.\d{1,2}(?:\s*(?:CR|DR))?)/gi;

function parseStatementDate(raw: string) {
  return parseDate(raw, "DMY") ?? parseDate(raw, "AUTO") ?? parseDate(raw, "MDY");
}

function extractAmounts(line: string): number[] {
  const amounts: number[] = [];
  let m: RegExpExecArray | null;
  const amountRe = new RegExp(AMOUNT_RE.source, "gi");
  while ((m = amountRe.exec(line)) !== null) {
    const full = m[0];
    const raw = m[1] ?? full;
    let value = parseMoney(raw);
    if (value === 0) continue;
    if (/\bDR\b/i.test(full)) value = -Math.abs(value);
    amounts.push(value);
  }
  return amounts;
}

function pickTransactionAmount(amounts: number[]): number | null {
  if (!amounts.length) return null;
  if (amounts.length === 1) return amounts[0];
  // Last column is often running balance — prefer earlier monetary columns
  if (amounts.length >= 2) return amounts[amounts.length - 2];
  return amounts[amounts.length - 1];
}

function tryParseChunk(line: string): ParsedImportRow | null {
  const dateMatch = line.match(DATE_RE);
  if (!dateMatch) return null;
  const date = parseStatementDate(dateMatch[1]);
  if (!date) return null;

  const amounts = extractAmounts(line);
  const amount = pickTransactionAmount(amounts);
  if (amount == null) return null;

  let description = line
    .replace(dateMatch[0], " ")
    .replace(new RegExp(AMOUNT_RE.source, "gi"), " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!description || description.length < 2) description = "Statement transaction";

  if (
    /^(date|description|balance|opening|closing|total|account|statement|page\b|transaction)/i.test(
      description,
    )
  ) {
    return null;
  }

  return {
    date,
    description,
    moneyIn: amount > 0 ? Math.abs(amount) : 0,
    moneyOut: amount < 0 ? Math.abs(amount) : 0,
  };
}

function tryParseColumnLine(line: string): ParsedImportRow | null {
  const parts = line
    .split(/\s{2,}|\t|\|/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const dateIdx = parts.findIndex((p) => parseStatementDate(p));
  if (dateIdx < 0) return null;
  const date = parseStatementDate(parts[dateIdx])!;

  let moneyIn = 0;
  let moneyOut = 0;
  let description = "";

  for (let i = 0; i < parts.length; i++) {
    if (i === dateIdx) continue;
    const value = parseMoney(parts[i]);
    if (value !== 0 && /^\(?\$?\d/.test(parts[i])) {
      if (moneyIn === 0 && moneyOut === 0) {
        if (value < 0) moneyOut = Math.abs(value);
        else moneyIn = Math.abs(value);
      } else if (value > 0 && moneyIn === 0) moneyIn = Math.abs(value);
      else if (value < 0 && moneyOut === 0) moneyOut = Math.abs(value);
      continue;
    }
    if (!looksLikeDateCell(parts[i]) && parts[i].length > description.length) {
      description = parts[i];
    }
  }

  if (moneyIn === 0 && moneyOut === 0) {
    const amounts = parts
      .map((p) => parseMoney(p))
      .filter((v) => v !== 0);
    const picked = pickTransactionAmount(amounts);
    if (picked == null) return null;
    if (picked > 0) moneyIn = Math.abs(picked);
    else moneyOut = Math.abs(picked);
  }

  if (!description) description = "Statement transaction";
  return { date, description, moneyIn, moneyOut };
}

function looksLikeDateCell(cell: string) {
  return Boolean(parseStatementDate(cell));
}

function splitIntoDateSegments(text: string): string[] {
  const matches = [...text.matchAll(DATE_GLOBAL)];
  if (!matches.length) return [];
  const segments: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    segments.push(text.slice(start, end).replace(/\s+/g, " ").trim());
  }
  return segments;
}

/**
 * Heuristic parser for statement text from PDF/OCR or XML dumps.
 * Looks for lines containing a date and at least one money amount.
 */
export function parseStatementText(text: string): {
  rows: ParsedImportRow[];
  errors: string[];
} {
  const rows: ParsedImportRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  const pushRow = (row: ParsedImportRow | null) => {
    if (!row) return;
    const key = `${row.date.toISOString()}|${row.description}|${row.moneyIn}|${row.moneyOut}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };

  const normalized = text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");

  const lines = normalized
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const expanded: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] ?? "";
    const hasDate = DATE_RE.test(line);
    const hasAmount = AMOUNT_RE.test(line);
    AMOUNT_RE.lastIndex = 0;
    DATE_RE.lastIndex = 0;
    if (hasDate && !hasAmount && /\d+\.\d{1,2}/.test(next)) {
      expanded.push(`${line} ${next}`);
      i += 1;
    } else {
      expanded.push(line);
    }
  }

  for (const line of expanded) {
    pushRow(tryParseColumnLine(line));
    pushRow(tryParseChunk(line));
  }

  for (const segment of splitIntoDateSegments(normalized.replace(/\n/g, " "))) {
    pushRow(tryParseColumnLine(segment));
    pushRow(tryParseChunk(segment));
  }

  if (!rows.length) {
    const meaningfulChars = normalized.replace(/\s/g, "").length;
    if (meaningfulChars < 40) {
      errors.push(
        "This PDF has little or no selectable text (often a scanned statement). Enable “OCR PDF pages” in the sidebar, upload a clear photo, or export CSV/Excel from your bank.",
      );
    } else {
      errors.push(
        "Text was read from the PDF, but no lines matched date + amount. Try CSV/Excel from your bank, or enable “OCR PDF pages” if amounts are in images.",
      );
    }
  }

  return { rows, errors };
}
