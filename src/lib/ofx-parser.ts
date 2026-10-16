import type { ParsedImportRow } from "@/lib/import-parser";

function tagValue(block: string, tag: string): string {
  const re = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i");
  const match = block.match(re);
  return match?.[1]?.trim() ?? "";
}

function parseOfxDate(raw: string): Date | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function splitTransactions(text: string): string[] {
  const matches = text.match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>|<\/CCSTMTTRNRS>|$)/gi);
  return matches ?? [];
}

/**
 * Parses OFX / QBO (Web Connect) statement text into import rows.
 * QBO is OFX with optional INTU.BID metadata — same transaction structure.
 */
export function parseOfxOrQbo(
  text: string,
  options?: { invertCreditCard?: boolean },
): { rows: ParsedImportRow[]; errors: string[]; accountTypeHint?: "BANK" | "CREDIT_CARD" } {
  const cleaned = text.replace(/\r\n/g, "\n");
  const isCreditCard = /<CREDITCARDMSGSRSV1>|<CCACCTFROM>/i.test(cleaned);
  const blocks = splitTransactions(cleaned);
  const rows: ParsedImportRow[] = [];
  const errors: string[] = [];

  blocks.forEach((block, index) => {
    const date =
      parseOfxDate(tagValue(block, "DTPOSTED")) ??
      parseOfxDate(tagValue(block, "DTUSER"));
    const amountRaw = tagValue(block, "TRNAMT");
    const amount = Number.parseFloat(amountRaw);
    const name = tagValue(block, "NAME") || tagValue(block, "MEMO") || "OFX transaction";
    const memo = tagValue(block, "MEMO");
    const fitid = tagValue(block, "FITID");
    const trnType = tagValue(block, "TRNTYPE").toUpperCase();

    if (!date) {
      errors.push(`OFX txn ${index + 1}: invalid date`);
      return;
    }
    if (!Number.isFinite(amount) || amount === 0) {
      errors.push(`OFX txn ${index + 1}: invalid amount`);
      return;
    }

    let moneyIn = 0;
    let moneyOut = 0;

    // Bank OFX: positive = money in, negative = money out
    // Credit card statements sometimes flip; optional invert
    const signed = options?.invertCreditCard && isCreditCard ? -amount : amount;
    if (signed > 0) moneyIn = Math.abs(signed);
    else moneyOut = Math.abs(signed);

    // Prefer explicit type when amount sign is ambiguous at zero (already filtered)
    if (trnType === "CREDIT" && moneyOut > 0 && moneyIn === 0) {
      moneyIn = moneyOut;
      moneyOut = 0;
    }
    if ((trnType === "DEBIT" || trnType === "PAYMENT" || trnType === "CHECK") && moneyIn > 0 && moneyOut === 0) {
      moneyOut = moneyIn;
      moneyIn = 0;
    }

    rows.push({
      date,
      description: memo && memo !== name ? `${name} — ${memo}` : name,
      moneyIn,
      moneyOut,
      notes: fitid ? `FITID:${fitid}` : undefined,
      externalTransactionId: fitid || undefined,
    });
  });

  return {
    rows,
    errors,
    accountTypeHint: isCreditCard ? "CREDIT_CARD" : "BANK",
  };
}

export function isOfxOrQboFileName(name: string) {
  const lower = name.toLowerCase();
  return lower.endsWith(".ofx") || lower.endsWith(".qbo") || lower.endsWith(".qfx");
}
