import { XMLParser } from "fast-xml-parser";
import type { ParsedImportRow } from "@/lib/import-parser";
import { parseOfxOrQbo } from "@/lib/ofx-parser";
import { parseStatementText } from "@/lib/statement-text";

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  const raw = String(value).trim();
  if (/^\d{8}/.test(raw)) {
    const y = Number(raw.slice(0, 4));
    const m = Number(raw.slice(4, 6));
    const d = Number(raw.slice(6, 8));
    return new Date(Date.UTC(y, m - 1, d));
  }
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return null;
  const dt = new Date(parsed);
  return new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value == null) return 0;
  const n = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function pick(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (obj[key] != null && String(obj[key]).trim() !== "") return obj[key];
    const found = Object.keys(obj).find((k) => k.toLowerCase() === key.toLowerCase());
    if (found && obj[found] != null) return obj[found];
  }
  return undefined;
}

/**
 * Parses bank XML statements:
 * - OFX/QFX saved as .xml
 * - Generic <Transaction> / <StmtTrn> / CAMT-like entries
 * - Fallback: flatten text and run statement-text heuristics
 */
export function parseBankXml(xmlText: string): {
  rows: ParsedImportRow[];
  errors: string[];
} {
  const trimmed = xmlText.trim();
  if (/<OFX|<STMTTRN|<BANKMSGSRSV1/i.test(trimmed)) {
    return parseOfxOrQbo(trimmed);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    trimValues: true,
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(trimmed);
  } catch {
    return parseStatementText(trimmed);
  }

  const rows: ParsedImportRow[] = [];
  const errors: string[] = [];

  const collect = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(collect);
      return;
    }
    const obj = node as Record<string, unknown>;
    const keys = Object.keys(obj);

    // Recurse first into known containers
    for (const key of keys) {
      if (
        /transaction|stmttrn|ntry|entry|records|items/i.test(key) &&
        typeof obj[key] === "object"
      ) {
        for (const item of asArray(obj[key])) {
          if (item && typeof item === "object") {
            maybePushTransaction(item as Record<string, unknown>);
          }
        }
      } else if (typeof obj[key] === "object") {
        collect(obj[key]);
      }
    }
  };

  const maybePushTransaction = (obj: Record<string, unknown>) => {
    const dateRaw = pick(obj, [
      "date",
      "Date",
      "posted",
      "PostedDate",
      "transactionDate",
      "BookingDate",
      "ValueDate",
      "DTPOSTED",
      "Dt",
    ]);
    const descRaw = pick(obj, [
      "description",
      "Description",
      "memo",
      "Memo",
      "name",
      "Name",
      "payee",
      "Payee",
      "narrative",
      "Details",
      "RltdPties",
    ]);
    const amountRaw = pick(obj, [
      "amount",
      "Amount",
      "TRNAMT",
      "Amt",
      "value",
      "Value",
      "transactionAmount",
    ]);
    const moneyInRaw = pick(obj, ["moneyIn", "credit", "Credit", "deposit", "Deposit"]);
    const moneyOutRaw = pick(obj, ["moneyOut", "debit", "Debit", "withdrawal", "Withdrawal"]);
    const fitid = pick(obj, ["FITID", "fitid", "id", "Id", "transactionId"]);

    const date = toDate(dateRaw);
    if (!date) return;

    let moneyIn = Math.abs(toNumber(moneyInRaw));
    let moneyOut = Math.abs(toNumber(moneyOutRaw));
    if (!moneyIn && !moneyOut) {
      const amount = toNumber(amountRaw);
      if (amount > 0) moneyIn = amount;
      else if (amount < 0) moneyOut = Math.abs(amount);
    }
    if (!moneyIn && !moneyOut) return;

    let description = "";
    if (typeof descRaw === "string") description = descRaw;
    else if (descRaw && typeof descRaw === "object") {
      description = JSON.stringify(descRaw).slice(0, 180);
    }
    if (!description) description = "XML transaction";

    rows.push({
      date,
      description,
      moneyIn,
      moneyOut,
      externalTransactionId: fitid ? String(fitid) : undefined,
    });
  };

  collect(parsed);

  if (!rows.length) {
    // Last resort: strip tags and parse as text
    const textOnly = trimmed.replace(/<[^>]+>/g, " ");
    return parseStatementText(textOnly);
  }

  return { rows, errors };
}
