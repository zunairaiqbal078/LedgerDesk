import Papa from "papaparse";
import * as XLSX from "xlsx";

export type DateFormatPreference = "DMY" | "MDY" | "YMD" | "AUTO";

export type ImportMatrix = {
  headers: string[];
  rows: string[][];
  fileName: string;
  headerRowIndex: number;
};

export type ColumnMapping = {
  date: string;
  description: string;
  moneyIn?: string;
  moneyOut?: string;
  amount?: string;
  /** Column with values like Withdrawal / Deposit / Fee / Payment */
  txnType?: string;
  signedRule?: "positiveIn" | "positiveOut";
  dateFormat?: DateFormatPreference;
  accountNumber?: string;
  accountName?: string;
  province?: string;
  notes?: string;
};

export type ParsedImportRow = {
  date: Date;
  description: string;
  moneyIn: number;
  moneyOut: number;
  accountNumber?: string;
  accountName?: string;
  province?: string;
  notes?: string;
  externalTransactionId?: string;
};

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function cleanCell(value: unknown) {
  if (value == null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial date (days since 1899-12-30)
    if (value > 20000 && value < 80000) {
      const parsed = excelSerialToDate(value);
      if (parsed) return parsed.toISOString().slice(0, 10);
    }
    return String(value);
  }
  return String(value).replace(/\u00a0/g, " ").trim();
}

function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  // Excel's epoch quirk: day 0 = 1899-12-30
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function parseMoney(raw: string): number {
  if (!raw) return 0;
  let text = raw.replace(/\u00a0/g, " ").trim();
  if (!text || /^[-–—]+$/.test(text)) return 0;
  const negative =
    /^\(.*\)$/.test(text) || text.startsWith("-") || text.startsWith("−");
  // Canadian exports are usually "1,234.56"
  text = text.replace(/CAD|USD|\$/gi, "").trim();
  if (text.includes(",") && text.includes(".")) {
    text = text.replace(/,/g, "");
  } else if (text.includes(",") && !text.includes(".")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else {
    text = text.replace(/,/g, "");
  }
  text = text.replace(/[^0-9.-]/g, "");
  const amount = Number.parseFloat(text);
  if (!Number.isFinite(amount) || amount === 0) return 0;
  return negative ? -Math.abs(amount) : amount;
}

function utcDate(year: number, monthIndex: number, day: number): Date | null {
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
  if (year < 1970 || year > 2100) return null;
  const d = new Date(Date.UTC(year, monthIndex, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== monthIndex ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

export function parseDate(
  raw: string,
  preference: DateFormatPreference = "AUTO",
): Date | null {
  if (!raw) return null;
  const trimmed = raw.replace(/\u00a0/g, " ").trim();
  if (!trimmed) return null;

  // Excel serial stored as plain number/string
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (n > 20000 && n < 80000) return excelSerialToDate(n);
  }

  // YYYY-MM-DD / YYYY/MM/DD
  let m = trimmed.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) return utcDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  // DD-MMM-YYYY / DD MMM YYYY
  m = trimmed.match(/^(\d{1,2})[\/\-.\s]+([A-Za-z]{3,9})[\/\-.\s]+(\d{2,4})$/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month != null) {
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      return utcDate(year, month, Number(m[1]));
    }
  }

  // MMM DD, YYYY / Month D, YYYY
  m = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month != null) {
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      return utcDate(year, month, Number(m[2]));
    }
  }

  // Numeric d/m/y or m/d/y
  m = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;

    const asDmy = utcDate(year, b - 1, a);
    const asMdy = utcDate(year, a - 1, b);

    if (preference === "YMD") {
      // already handled above for 4-digit year first
    }
    if (preference === "DMY") return asDmy;
    if (preference === "MDY") return asMdy;

    // AUTO: disambiguate like Canadian banks (prefer DMY when clear)
    if (a > 12 && b <= 12) return asDmy;
    if (b > 12 && a <= 12) return asMdy;
    // Both possible → prefer DMY for Canadian bookkeeping
    return asDmy ?? asMdy;
  }

  const iso = Date.parse(trimmed);
  if (!Number.isNaN(iso)) {
    const d = new Date(iso);
    return utcDate(d.getFullYear(), d.getMonth(), d.getDate());
  }

  return null;
}

const HEADER_HINTS = [
  "date",
  "description",
  "memo",
  "payee",
  "amount",
  "debit",
  "credit",
  "withdrawal",
  "deposit",
  "balance",
  "details",
  "transaction",
  "narrative",
];

const TXN_TYPE_WORDS =
  /^(fee|fees|interest|payment|payments|withdrawal|withdrawals|deposit|deposits|purchase|purchases|transfer|transfers|credit|debit|charge|charges|refund|pos|visa|mastercard|atm|cheque|check|e-?transfer|payroll)$/i;

function looksLikeDateCell(cell: string) {
  return Boolean(parseDate(cell, "AUTO") || parseDate(cell, "MDY") || parseDate(cell, "DMY"));
}

function looksLikePureNumber(cell: string) {
  if (!cell) return false;
  return /^-?\(?\$?\d[\d,]*\.?\d*\)?$/.test(cell.replace(/\s/g, ""));
}

function isLikelyIdOrReference(cell: string) {
  const trimmed = cell.trim();
  if (!trimmed) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length / trimmed.length > 0.65;
}

/** Bank exports often include a short privacy-masked description and a fuller memo column. */
function looksMaskedDescription(cell: string) {
  const t = cell.trim();
  if (!t) return false;
  if (/\*{2,}/.test(t)) return true;
  if (/^send e-?tfr\b/i.test(t) && t.length < 40) return true;
  if (/^e-?transfer\b/i.test(t) && t.length < 40) return true;
  if (/^reclaim e-?tfr\b/i.test(t) && t.length < 40) return true;
  return false;
}

function descriptionColumnScore(matrix: ImportMatrix, colIndex: number, sampleN: number) {
  const values = columnValues(matrix, colIndex, sampleN).map((v) => v.replace(/\s+/g, " ").trim());
  const meaningful = values.filter(
    (v) =>
      v &&
      !looksLikeDateCell(v) &&
      !looksLikePureNumber(v) &&
      !isLikelyIdOrReference(v) &&
      !TXN_TYPE_WORDS.test(v),
  );
  if (!meaningful.length) return 0;
  const avgLen = meaningful.reduce((sum, v) => sum + v.length, 0) / meaningful.length;
  const masked = meaningful.filter((v) => looksMaskedDescription(v)).length;
  const maskedRatio = masked / meaningful.length;
  const header = (matrix.headers[colIndex] ?? "").toLowerCase();
  let headerBoost = 0;
  if (/description|details|narrative|memo|merchant|particulars|comments/.test(header)) {
    headerBoost = 14;
  } else if (/payee|^name\b|\bname \(/.test(header) && maskedRatio < 0.2) {
    headerBoost = 4;
  }
  if (maskedRatio > 0.35) headerBoost = Math.min(headerBoost, 2);
  return avgLen * (1 - maskedRatio) + headerBoost;
}

function pickBestDescriptionColumn(
  matrix: ImportMatrix,
  usedIndices: Set<number>,
  sampleN: number,
) {
  let bestIdx = -1;
  let bestScore = -1;
  for (let i = 0; i < matrix.headers.length; i++) {
    if (usedIndices.has(i)) continue;
    const score = descriptionColumnScore(matrix, i, sampleN);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx >= 0 ? matrix.headers[bestIdx] : undefined;
}

function enrichDescriptionFromRow(
  matrix: ImportMatrix,
  row: string[],
  mapping: ColumnMapping,
  headerIndex: Record<string, number>,
  current: string,
) {
  const get = (key?: string) =>
    key && headerIndex[key] != null ? row[headerIndex[key]] ?? "" : "";
  const usedKeys = new Set(
    [
      mapping.date,
      mapping.moneyIn,
      mapping.moneyOut,
      mapping.amount,
      mapping.txnType,
      mapping.accountNumber,
      mapping.accountName,
    ].filter(Boolean) as string[],
  );

  let best = current.replace(/\s+/g, " ").trim();
  const alternates: string[] = [];

  for (const header of matrix.headers) {
    if (usedKeys.has(header) || header === mapping.description) continue;
    const raw = get(header).replace(/\s+/g, " ").trim();
    if (!raw || raw === best) continue;
    if (looksLikeDateCell(raw) || looksLikePureNumber(raw) || isLikelyIdOrReference(raw)) continue;
    if (TXN_TYPE_WORDS.test(raw) && raw.length < 24) continue;
    alternates.push(raw);
  }

  alternates.sort((a, b) => b.length - a.length);
  for (const raw of alternates) {
    if (looksMaskedDescription(best) && !looksMaskedDescription(raw)) {
      best = raw;
      break;
    }
    if (raw.length > best.length + 6) {
      best = raw;
      break;
    }
  }

  if (looksMaskedDescription(best) && alternates.length) {
    const full = alternates.find((t) => !looksMaskedDescription(t) && t.length > best.length);
    if (full) best = full;
  }

  return best;
}

function scoreHeaderRow(cells: string[]) {
  const lower = cells.map((c) => c.toLowerCase());
  let score = 0;
  let dataLike = 0;
  for (const cell of lower) {
    if (!cell) continue;
    if (HEADER_HINTS.some((h) => cell.includes(h))) score += 3;
    if (looksLikeDateCell(cell)) dataLike += 2;
    if (looksLikePureNumber(cell) && !HEADER_HINTS.some((h) => cell.includes(h))) dataLike += 1;
    if (TXN_TYPE_WORDS.test(cell.trim())) dataLike += 2;
  }
  const nonEmpty = lower.filter(Boolean);
  if (nonEmpty.length >= 3) score += 1;
  // Strong penalty when the "header" is clearly a data row
  score -= dataLike;
  return score;
}

function matrixFromAoa(
  aoa: unknown[][],
  fileName: string,
): ImportMatrix {
  const data = aoa
    .map((row) => (Array.isArray(row) ? row.map(cleanCell) : []))
    .filter((row) => row.some(Boolean));

  if (!data.length) return { headers: [], rows: [], fileName, headerRowIndex: 0 };

  const width = Math.max(...data.map((r) => r.length));
  const normalized = data.map((row) => {
    const next = [...row];
    while (next.length < width) next.push("");
    return next;
  });

  let headerIdx = 0;
  let bestScore = -Infinity;
  const scan = Math.min(25, normalized.length);
  for (let i = 0; i < scan; i++) {
    const score = scoreHeaderRow(normalized[i]);
    if (score > bestScore) {
      bestScore = score;
      headerIdx = i;
    }
  }

  // Headerless bank dumps (common): first row is already transactions
  const headerless = bestScore < 3;
  if (headerless) {
    const headers = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    return {
      headers,
      rows: normalized,
      fileName,
      headerRowIndex: -1,
    };
  }

  const headers = normalized[headerIdx].map((h, idx) => h || `Column ${idx + 1}`);
  const seen = new Map<string, number>();
  const uniqueHeaders = headers.map((h) => {
    const count = seen.get(h) ?? 0;
    seen.set(h, count + 1);
    return count === 0 ? h : `${h} (${count + 1})`;
  });

  const rows = normalized
    .slice(headerIdx + 1)
    .map((row) => uniqueHeaders.map((_, i) => row[i] ?? ""))
    .filter((row) => row.some((cell) => cell.trim()));

  return { headers: uniqueHeaders, rows, fileName, headerRowIndex: headerIdx };
}

export function parseCsvText(text: string, fileName: string): ImportMatrix {
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
  });
  return matrixFromAoa(parsed.data ?? [], fileName);
}

export function parseExcelBuffer(buffer: ArrayBuffer, fileName: string): ImportMatrix {
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true,
    raw: false,
  });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });
  return matrixFromAoa(aoa, fileName);
}

export async function parseImportFile(file: File): Promise<ImportMatrix> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || file.type === "text/csv") {
    const text = await file.text();
    return parseCsvText(text, file.name);
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlx")) {
    const buffer = await file.arrayBuffer();
    return parseExcelBuffer(buffer, file.name);
  }
  throw new Error("Unsupported file type. Use CSV or Excel (.xlsx/.xls).");
}

function columnValues(matrix: ImportMatrix, colIndex: number, limit = 40) {
  return matrix.rows.slice(0, limit).map((row) => row[colIndex] ?? "");
}

function detectDateFormat(samples: string[]): DateFormatPreference {
  let dmyHits = 0;
  let mdyHits = 0;
  for (const raw of samples) {
    const m = raw.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmyHits += 1;
    if (b > 12 && a <= 12) mdyHits += 1;
  }
  if (mdyHits > dmyHits) return "MDY";
  if (dmyHits > mdyHits) return "DMY";
  return "AUTO";
}

function classifyTxnType(raw: string): "in" | "out" | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (
    /^(deposit|deposits|credit|credits|payment|payments|interest|refund|refunds|transfer in|payroll|salary)$/i.test(
      t,
    )
  ) {
    return "in";
  }
  if (
    /^(withdrawal|withdrawals|debit|debits|fee|fees|purchase|purchases|charge|charges|pos|atm|cheque|check|transfer out|visa|mastercard)$/i.test(
      t,
    )
  ) {
    return "out";
  }
  return null;
}

/** Header-name guess, then content-based refinement for headerless bank exports. */
export function guessMapping(
  headersOrMatrix: string[] | ImportMatrix,
  maybeMatrix?: ImportMatrix,
): Partial<ColumnMapping> {
  const matrix: ImportMatrix | null = Array.isArray(headersOrMatrix)
    ? (maybeMatrix ?? null)
    : headersOrMatrix;
  const headers = Array.isArray(headersOrMatrix) ? headersOrMatrix : headersOrMatrix.headers;

  const lower = headers.map((h) => h.toLowerCase().replace(/\s+/g, " "));
  const find = (...needles: string[]) =>
    headers.find((_, i) =>
      needles.some((n) => {
        const cell = lower[i];
        return cell === n || cell.includes(n);
      }),
    );

  const findExactish = (...needles: string[]) =>
    headers.find((_, i) => needles.some((n) => lower[i] === n || lower[i].startsWith(n)));

  let date =
    find(
      "transaction date",
      "posting date",
      "posted date",
      "trans date",
      "date posted",
      "date",
    ) ?? undefined;

  let description = find(
    "description",
    "transaction description",
    "transaction details",
    "details",
    "narrative",
    "memo",
    "particulars",
    "merchant",
    "comments",
  );

  let moneyIn = find(
    "money in",
    "credit amount",
    "credits",
    "deposit",
    "deposit amount",
    "deposits",
    "inflow",
    "paid in",
  );
  // Do NOT match bare "credit" / "withdrawal" alone when those are type labels in data
  let moneyOut = find(
    "money out",
    "debit amount",
    "debits",
    "withdrawal",
    "withdrawal amount",
    "withdrawals",
    "outflow",
    "paid out",
  );

  let amount =
    findExactish("amount", "cad amount", "transaction amount", "txn amount") ??
    find("amount");
  if (amount && /balance/i.test(amount)) amount = undefined;

  let txnType = find("type", "txn type", "transaction type", "trans type");
  let dateFormat: DateFormatPreference = "AUTO";
  let signedRule: "positiveIn" | "positiveOut" = "positiveIn";

  if (matrix && matrix.rows.length) {
    const colCount = matrix.headers.length;
    const sampleN = Math.min(50, matrix.rows.length);

    type ColScore = {
      index: number;
      dateHits: number;
      moneyHits: number;
      moneyAbsSum: number;
      textScore: number;
      typeHits: number;
      avgAbs: number;
      mostlyIncreasing: boolean;
    };

    const scores: ColScore[] = [];
    for (let i = 0; i < colCount; i++) {
      const values = columnValues(matrix, i, sampleN);
      let dateHits = 0;
      let moneyHits = 0;
      let moneyAbsSum = 0;
      let textScore = 0;
      let typeHits = 0;
      const nums: number[] = [];

      for (const v of values) {
        if (!v) continue;
        if (looksLikeDateCell(v)) dateHits += 1;
        const money = parseMoney(v);
        if (money !== 0 && looksLikePureNumber(v.replace(/[()$\s]/g, "").replace(/,/g, ""))) {
          moneyHits += 1;
          moneyAbsSum += Math.abs(money);
          nums.push(Math.abs(money));
        }
        if (TXN_TYPE_WORDS.test(v.trim()) || classifyTxnType(v)) typeHits += 1;
        const alpha = (v.match(/[A-Za-z]/g) ?? []).length;
        if (alpha >= 4 && !looksLikeDateCell(v) && !looksLikePureNumber(v)) {
          textScore += alpha + Math.min(v.length, 40);
        }
      }

      let increasing = 0;
      for (let k = 1; k < nums.length; k++) {
        if (nums[k] >= nums[k - 1]) increasing += 1;
      }
      const mostlyIncreasing =
        nums.length >= 4 && increasing / (nums.length - 1) >= 0.75;

      scores.push({
        index: i,
        dateHits,
        moneyHits,
        moneyAbsSum,
        textScore,
        typeHits,
        avgAbs: moneyHits ? moneyAbsSum / moneyHits : 0,
        mostlyIncreasing,
      });
    }

    const bestDate = [...scores].sort((a, b) => b.dateHits - a.dateHits)[0];
    if (bestDate && bestDate.dateHits >= Math.max(3, sampleN * 0.4)) {
      date = matrix.headers[bestDate.index];
      dateFormat = detectDateFormat(columnValues(matrix, bestDate.index, sampleN));
    } else if (!date) {
      date = matrix.headers[0];
    }

    const bestType = [...scores].sort((a, b) => b.typeHits - a.typeHits)[0];
    if (bestType && bestType.typeHits >= Math.max(3, sampleN * 0.35)) {
      txnType = matrix.headers[bestType.index];
    }

    // Amount: numeric column that is NOT mostly a running balance
    const amountCandidates = scores
      .filter((s) => s.moneyHits >= Math.max(3, sampleN * 0.35) && !s.mostlyIncreasing)
      .sort((a, b) => b.moneyHits - a.moneyHits || a.avgAbs - b.avgAbs);

    // Balance often has higher avg and is increasing — prefer smaller txn amounts
    const bestAmount = amountCandidates[0];
    if (bestAmount) {
      // If header-based moneyIn/Out point at type-label columns, clear them
      const moneyOutIdx = moneyOut ? matrix.headers.indexOf(moneyOut) : -1;
      const moneyInIdx = moneyIn ? matrix.headers.indexOf(moneyIn) : -1;
      const outIsType =
        moneyOutIdx >= 0 && scores[moneyOutIdx]?.typeHits >= scores[moneyOutIdx]?.moneyHits;
      const inIsType =
        moneyInIdx >= 0 && scores[moneyInIdx]?.typeHits >= scores[moneyInIdx]?.moneyHits;
      if (outIsType) moneyOut = undefined;
      if (inIsType) moneyIn = undefined;

      if (!moneyIn && !moneyOut) {
        amount = matrix.headers[bestAmount.index];
      }
    }

    // Description: prefer longest meaningful text (avoid masked / type columns)
    const used = new Set(
      [date, amount, moneyIn, moneyOut, txnType]
        .filter(Boolean)
        .map((h) => matrix.headers.indexOf(h as string)),
    );
    const picked = pickBestDescriptionColumn(matrix, used, sampleN);
    if (picked) description = picked;
    else if (!description) {
      description =
        find("payee", "name (payee") ??
        matrix.headers
          .slice()
          .reverse()
          .find((h, revIdx) => {
            const idx = matrix.headers.length - 1 - revIdx;
            return descriptionColumnScore(matrix, idx, sampleN) > 0;
          }) ??
        matrix.headers[Math.min(1, matrix.headers.length - 1)];
    }

    // Credit-card style: many "Withdrawal/Fee" types + positive amounts → positive is money out
    if (txnType && amount) {
      const types = columnValues(matrix, matrix.headers.indexOf(txnType), sampleN);
      const outTypes = types.filter((t) => classifyTxnType(t) === "out").length;
      const inTypes = types.filter((t) => classifyTxnType(t) === "in").length;
      if (outTypes > inTypes) signedRule = "positiveOut";
    }
  }

  return {
    date: date ?? headers[0],
    description: description ?? headers[1] ?? headers[0],
    moneyIn,
    moneyOut,
    amount: moneyIn || moneyOut ? undefined : amount,
    txnType,
    dateFormat,
    signedRule,
  };
}

export function mapRowsToTransactions(
  matrix: ImportMatrix,
  mapping: ColumnMapping,
): { rows: ParsedImportRow[]; errors: string[] } {
  const headerIndex = Object.fromEntries(matrix.headers.map((h, i) => [h, i]));
  const get = (row: string[], key?: string) =>
    key && headerIndex[key] != null ? row[headerIndex[key]] ?? "" : "";

  const rows: ParsedImportRow[] = [];
  const errors: string[] = [];
  const dateFormat = mapping.dateFormat ?? "AUTO";

  // If mapped money columns are actually non-numeric type labels, ignore them
  const sample = matrix.rows.slice(0, 15);
  const moneyInNumeric =
    mapping.moneyIn &&
    sample.some((r) => parseMoney(get(r, mapping.moneyIn)) !== 0);
  const moneyOutNumeric =
    mapping.moneyOut &&
    sample.some((r) => parseMoney(get(r, mapping.moneyOut)) !== 0);

  const useSplit = Boolean(
    (mapping.moneyIn && moneyInNumeric) || (mapping.moneyOut && moneyOutNumeric),
  );
  const useAmount = Boolean(mapping.amount) || (!useSplit && Boolean(mapping.txnType));

  // Auto-pick first strong numeric column if still no amount source
  let amountKey = mapping.amount;
  if (!useSplit && !amountKey) {
    for (const header of matrix.headers) {
      const hits = sample.filter((r) => parseMoney(get(r, header)) !== 0).length;
      if (hits >= Math.min(5, sample.length)) {
        amountKey = header;
        break;
      }
    }
  }

  matrix.rows.forEach((row, index) => {
    const dateRaw = get(row, mapping.date);
    const typeRaw = get(row, mapping.txnType);
    let description = get(row, mapping.description).replace(/\s+/g, " ").trim();
    description = enrichDescriptionFromRow(matrix, row, mapping, headerIndex, description);
    if (!description && typeRaw) description = typeRaw;
    if (!description && !dateRaw) return;

    // Skip subtotal / balance rows
    if (/^(total|balance|opening|closing|brought forward|carried forward)/i.test(description)) {
      return;
    }

    const date = parseDate(dateRaw, dateFormat);
    if (!date) {
      errors.push(`Row ${index + 2}: invalid date "${dateRaw}"`);
      return;
    }
    if (!description) {
      errors.push(`Row ${index + 2}: missing description`);
      return;
    }

    // Only fill in description when the mapped text is empty/thin; txn type stays in notes for rules.
    if (typeRaw && (looksLikePureNumber(description) || description.length < 3)) {
      description = `${typeRaw} ${description}`.trim();
    }

    let moneyIn = 0;
    let moneyOut = 0;

    if (useSplit) {
      moneyIn = moneyInNumeric ? Math.abs(parseMoney(get(row, mapping.moneyIn))) : 0;
      moneyOut = moneyOutNumeric ? Math.abs(parseMoney(get(row, mapping.moneyOut))) : 0;
    }

    if (moneyIn === 0 && moneyOut === 0) {
      // Prefer mapped amount column, then other numeric cells (skip ids / balances)
      const preferred = amountKey ?? mapping.amount;
      const amountKeys = [
        preferred,
        ...matrix.headers.filter((h) => h !== preferred),
      ].filter(Boolean) as string[];

      type Cand = { value: number; hasCents: boolean; preferred: boolean; key: string };
      const candidates: Cand[] = [];
      for (const key of amountKeys) {
        if (key === mapping.date || key === mapping.txnType || key === mapping.description) {
          continue;
        }
        const raw = get(row, key);
        const value = parseMoney(raw);
        if (value === 0) continue;
        // Skip huge account-like integers
        if (/^\d{7,}$/.test(raw.replace(/[^\d]/g, ""))) continue;
        const hasCents = /\.\d{1,2}\b/.test(raw);
        candidates.push({
          value,
          hasCents,
          preferred: key === preferred,
          key,
        });
      }

      candidates.sort((a, b) => {
        if (a.hasCents !== b.hasCents) return a.hasCents ? -1 : 1;
        if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
        return 0;
      });

      const signed = candidates[0]?.value ?? 0;
      const abs = Math.abs(signed);
      if (abs > 0) {
        const side = classifyTxnType(typeRaw);
        if (side === "in") moneyIn = abs;
        else if (side === "out") moneyOut = abs;
        else {
          const rule = mapping.signedRule ?? "positiveIn";
          if (rule === "positiveIn") {
            if (signed >= 0) moneyIn = abs;
            else moneyOut = abs;
          } else if (signed >= 0) moneyOut = abs;
          else moneyIn = abs;
        }
      }
    }

    if (moneyIn === 0 && moneyOut === 0) {
      errors.push(`Row ${index + 2}: no amount found`);
      return;
    }

    rows.push({
      date,
      description,
      moneyIn,
      moneyOut,
      accountNumber: get(row, mapping.accountNumber) || undefined,
      accountName: get(row, mapping.accountName) || undefined,
      province: get(row, mapping.province) || undefined,
      notes: get(row, mapping.notes) || typeRaw || undefined,
    });
  });

  return { rows, errors };
}

/** Parse grid data (PDF tables, pasted grids) using the same logic as CSV/Excel import. */
export function parseMatrixFromAoa(
  aoa: unknown[][],
  fileName = "statement",
): { rows: ParsedImportRow[]; errors: string[] } {
  const matrix = matrixFromAoa(aoa, fileName);
  if (!matrix.rows.length) return { rows: [], errors: [] };

  const partial = guessMapping(matrix);
  const mapping: ColumnMapping = {
    date: partial.date ?? matrix.headers[0] ?? "Column 1",
    description:
      partial.description ?? matrix.headers[1] ?? matrix.headers[0] ?? "Column 2",
    moneyIn: partial.moneyIn,
    moneyOut: partial.moneyOut,
    amount: partial.amount,
    txnType: partial.txnType,
    dateFormat: partial.dateFormat ?? "DMY",
    signedRule: partial.signedRule,
  };

  const result = mapRowsToTransactions(matrix, mapping);
  if (result.rows.length) {
    return { rows: result.rows, errors: [] };
  }
  return { rows: [], errors: result.errors.slice(0, 8) };
}
