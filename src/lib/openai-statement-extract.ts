import { z } from "zod";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { ParsedImportRow } from "@/lib/import-parser";
import { CANADA_BANK_STATEMENT_KNOWLEDGE } from "@/lib/canada-bank-statement-knowledge";
import { getOpenAI, getOpenAiPdfModel, isOpenRouter } from "@/lib/openai-client";

export type BankHint = {
  institutionName: string | null;
  statementType: "BANK" | "CREDIT_CARD" | null;
  accountLast4: string | null;
  confidence: "high" | "medium" | "low";
  openingBalance?: number | null;
  closingBalance?: number | null;
  totalWithdrawals?: number | null;
  totalDeposits?: number | null;
  periodLabel?: string | null;
};

export type AiExtractResult = {
  rows: ParsedImportRow[];
  bankHint: BankHint;
  warnings: string[];
  source: "openai-text" | "openai-vision";
};

const AiRowSchema = z.object({
  date: z.string().min(4),
  description: z.string().min(1),
  moneyIn: z.number().default(0),
  moneyOut: z.number().default(0),
  /** Running balance AFTER this line (signed, as printed). Critical for debit/credit fix. */
  balanceAfter: z.number().nullable().optional(),
  /** Which statement column the amount came from */
  side: z.enum(["withdrawal", "deposit", "opening", "closing", "unknown"]).optional(),
  notes: z.string().optional().nullable(),
  externalTransactionId: z.string().optional().nullable(),
});

const AiPayloadSchema = z.object({
  transactions: z.array(AiRowSchema).default([]),
  institutionName: z.string().nullable().optional(),
  statementType: z.enum(["BANK", "CREDIT_CARD"]).nullable().optional(),
  accountLast4: z.string().nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  openingBalance: z.number().nullable().optional(),
  closingBalance: z.number().nullable().optional(),
  totalWithdrawals: z.number().nullable().optional(),
  totalDeposits: z.number().nullable().optional(),
  periodLabel: z.string().nullable().optional(),
  warnings: z.array(z.string()).optional(),
});

const SYSTEM_PROMPT = `You are ChatGPT-class Canadian statement reader + senior bookkeeper.
Read the PDF pages (and any text) like a human: use visual/column layout, not scrambled text alone.

${CANADA_BANK_STATEMENT_KNOWLEDGE}

════════════════════════════════════════
OUTPUT JSON ONLY (exact posted lines)
════════════════════════════════════════
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "MISC PAYMENT FIRST DATA CANADA(J) VIDP…",
      "moneyIn": 1341.98,
      "moneyOut": 0,
      "balanceAfter": -23866.89,
      "side": "deposit",
      "notes": null,
      "externalTransactionId": null
    }
  ],
  "institutionName": "CIBC",
  "statementType": "BANK",
  "accountLast4": "0918",
  "openingBalance": -12677.19,
  "closingBalance": -4110.82,
  "totalWithdrawals": 50151.97,
  "totalDeposits": 58718.34,
  "periodLabel": "Dec 1 to Dec 31, 2024",
  "confidence": "high",
  "warnings": []
}

RULES:
- Cover EVERY page. Do not invent. Do not mark almost everything as withdrawal.
- Always set balanceAfter when a running balance is printed.
- side must be withdrawal|deposit|opening|closing|unknown.
- Join multi-line descriptions into one string.
- If unsure of side, use balance delta — NEVER default all to withdrawal.`;

const MAX_TEXT_CHARS = 120_000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const INVALID_ROW_RETRY_RATIO = 0.4;

function parseIsoDate(raw: string): Date | null {
  const trimmed = raw.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

type RawTxn = z.infer<typeof AiRowSchema>;

/** Fix moneyIn/moneyOut using running balance deltas (CIBC-style scrambled text). */
function reconcileSignsFromBalances(
  items: RawTxn[],
  openingBalance: number | null | undefined,
): RawTxn[] {
  const withBal = items.filter((i) => typeof i.balanceAfter === "number");
  if (withBal.length < 2 && openingBalance == null) return items;

  let prev =
    typeof openingBalance === "number"
      ? openingBalance
      : typeof items[0]?.balanceAfter === "number"
        ? // before first txn unknown — skip first delta
          null
        : null;

  return items.map((item) => {
    if (item.side === "opening" || item.side === "closing") {
      if (typeof item.balanceAfter === "number") prev = item.balanceAfter;
      return item;
    }
    if (typeof item.balanceAfter !== "number") return item;

    const bal = item.balanceAfter;
    if (prev == null) {
      prev = bal;
      if (item.side === "deposit" || item.side === "withdrawal") {
        const amt = Math.abs(item.moneyIn || item.moneyOut || 0);
        return {
          ...item,
          moneyIn: item.side === "deposit" ? amt : 0,
          moneyOut: item.side === "withdrawal" ? amt : 0,
        };
      }
      return item;
    }

    const delta = round2(bal - prev);
    prev = bal;
    if (Math.abs(delta) < 0.005) return item;

    // Algebraic balance increase → deposit; decrease → withdrawal (works with overdraft negatives)
    if (delta > 0) {
      return {
        ...item,
        moneyIn: Math.abs(delta),
        moneyOut: 0,
        side: "deposit",
      };
    }
    return {
      ...item,
      moneyIn: 0,
      moneyOut: Math.abs(delta),
      side: "withdrawal",
    };
  });
}

function applySideHints(items: RawTxn[]): RawTxn[] {
  return items.map((item) => {
    if (item.side === "deposit") {
      const amt = Math.abs(item.moneyIn || item.moneyOut || 0);
      return { ...item, moneyIn: amt, moneyOut: 0 };
    }
    if (item.side === "withdrawal") {
      const amt = Math.abs(item.moneyIn || item.moneyOut || 0);
      return { ...item, moneyIn: 0, moneyOut: amt };
    }
    return item;
  });
}

function normalizeRows(
  payload: z.infer<typeof AiPayloadSchema>,
): { rows: ParsedImportRow[]; warnings: string[]; invalidCount: number } {
  const warnings = [...(payload.warnings ?? [])];
  let invalidCount = 0;
  const seen = new Set<string>();

  let items = applySideHints(payload.transactions);
  items = reconcileSignsFromBalances(items, payload.openingBalance);

  const rows: ParsedImportRow[] = [];

  for (const item of items) {
    const date = parseIsoDate(item.date);
    let moneyIn = Number(item.moneyIn) || 0;
    let moneyOut = Number(item.moneyOut) || 0;
    if (moneyIn < 0) {
      moneyOut += Math.abs(moneyIn);
      moneyIn = 0;
    }
    if (moneyOut < 0) {
      moneyIn += Math.abs(moneyOut);
      moneyOut = 0;
    }
    if (moneyIn > 0 && moneyOut > 0) {
      if (item.side === "deposit") moneyOut = 0;
      else if (item.side === "withdrawal") moneyIn = 0;
      else if (moneyIn >= moneyOut) moneyOut = 0;
      else moneyIn = 0;
    }

    const description = item.description.replace(/\s+/g, " ").trim();
    const isBalanceMarker = item.side === "opening" || item.side === "closing";

    if (!date || !description) {
      invalidCount += 1;
      continue;
    }
    if (!isBalanceMarker && moneyIn <= 0 && moneyOut <= 0) {
      invalidCount += 1;
      continue;
    }

    // Skip pure "Balance forward" noise
    if (/^balance forward$/i.test(description)) continue;

    const noteParts: string[] = [];
    if (item.notes?.trim()) noteParts.push(item.notes.trim());
    if (typeof item.balanceAfter === "number") {
      noteParts.push(`balance=${item.balanceAfter}`);
    }
    if (isBalanceMarker) {
      noteParts.push(item.side === "opening" ? "OPENING_BALANCE" : "CLOSING_BALANCE");
      if (typeof item.balanceAfter === "number" && moneyIn <= 0 && moneyOut <= 0) {
        // Keep marker visible in preview with zero amounts
        moneyIn = 0;
        moneyOut = 0;
      }
    }

    const key = `${date.toISOString().slice(0, 10)}|${description}|${moneyIn}|${moneyOut}|${item.side ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      date,
      description,
      moneyIn: round2(moneyIn),
      moneyOut: round2(moneyOut),
      notes: noteParts.length ? noteParts.join(" | ") : undefined,
      externalTransactionId: item.externalTransactionId?.trim() || undefined,
    });
  }

  const sumOut = rows.reduce((s, r) => s + r.moneyOut, 0);
  const sumIn = rows.reduce((s, r) => s + r.moneyIn, 0);
  if (
    typeof payload.totalWithdrawals === "number" &&
    payload.totalWithdrawals > 0 &&
    Math.abs(sumOut - payload.totalWithdrawals) > 5
  ) {
    warnings.push(
      `Withdrawals sum $${sumOut.toFixed(2)} vs statement total $${payload.totalWithdrawals.toFixed(2)} — review preview.`,
    );
  }
  if (
    typeof payload.totalDeposits === "number" &&
    payload.totalDeposits > 0 &&
    Math.abs(sumIn - payload.totalDeposits) > 5
  ) {
    warnings.push(
      `Deposits sum $${sumIn.toFixed(2)} vs statement total $${payload.totalDeposits.toFixed(2)} — review preview.`,
    );
  }

  // Golden rule: opening + deposits − withdrawals ≈ closing
  if (
    typeof payload.openingBalance === "number" &&
    typeof payload.closingBalance === "number"
  ) {
    const expected = round2(payload.openingBalance + sumIn - sumOut);
    const gap = Math.abs(expected - payload.closingBalance);
    if (gap > 1) {
      warnings.push(
        `Balance check: opening + deposits − withdrawals = $${expected.toFixed(2)} vs closing $${payload.closingBalance.toFixed(2)} (gap $${gap.toFixed(2)}).`,
      );
    }
  }

  return { rows, warnings, invalidCount };
}

function toBankHint(payload: z.infer<typeof AiPayloadSchema>): BankHint {
  return {
    institutionName: payload.institutionName?.trim() || null,
    statementType: payload.statementType ?? null,
    accountLast4: payload.accountLast4?.trim() || null,
    confidence: payload.confidence ?? "medium",
    openingBalance: payload.openingBalance ?? null,
    closingBalance: payload.closingBalance ?? null,
    totalWithdrawals: payload.totalWithdrawals ?? null,
    totalDeposits: payload.totalDeposits ?? null,
    periodLabel: payload.periodLabel ?? null,
  };
}

async function callJsonModel(
  userContent: Array<
    | { type: "text"; text: string }
    | { type: "file"; file: { filename: string; file_data: string } }
  >,
  stricter = false,
): Promise<z.infer<typeof AiPayloadSchema>> {
  const client = getOpenAI();
  if (!client) throw new Error("OPENAI_API_KEY is not configured.");

  const model = getOpenAiPdfModel();
  const system = stricter
    ? `${SYSTEM_PROMPT}\n\nRETRY: Many rows were invalid OR almost all were withdrawals. Re-extract carefully. For every line set moneyIn/moneyOut using Withdrawals vs Deposits columns OR balanceAfter delta. Include balanceAfter on every posted line.`
    : SYSTEM_PROMPT;

  const hasFile = userContent.some((c) => c.type === "file");
  const openRouter = isOpenRouter();

  // Native OpenAI Responses API (PDF as input_file). Skip on OpenRouter.
  if (!openRouter) {
    try {
      if (hasFile || typeof (client as { responses?: unknown }).responses !== "undefined") {
        const inputContent = userContent.map((part) => {
          if (part.type === "text") {
            return { type: "input_text" as const, text: part.text };
          }
          return {
            type: "input_file" as const,
            filename: part.file.filename,
            file_data: part.file.file_data,
          };
        });
        const response = await client.responses.create({
          model,
          input: [
            { role: "system", content: system },
            { role: "user", content: inputContent },
          ],
          text: { format: { type: "json_object" } },
        });
        const raw = response.output_text?.trim() || "{}";
        return AiPayloadSchema.parse(JSON.parse(raw));
      }
    } catch (err) {
      if (hasFile) throw err;
    }
  }

  const textParts = userContent
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n\n");

  // OpenRouter / chat: multimodal file+text when PDF bytes are present
  const userMessageContent = hasFile
    ? userContent.map((part) =>
        part.type === "text"
          ? { type: "text" as const, text: part.text }
          : {
              type: "file" as const,
              file: {
                filename: part.file.filename,
                file_data: part.file.file_data,
              },
            },
      )
    : textParts;

  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: userMessageContent },
  ];

  const baseBody = {
    model,
    stream: false as const,
    response_format: { type: "json_object" as const },
    messages,
  };

  let completion: ChatCompletion;
  try {
    completion = await client.chat.completions.create({
      ...baseBody,
      temperature: 0,
      max_completion_tokens: 32_768,
      ...(openRouter ? { reasoning: { effort: "none" } } : {}),
    // OpenRouter extras (reasoning) aren’t in the SDK types yet
    } as never);
  } catch {
    try {
      completion = await client.chat.completions.create({
        ...baseBody,
        max_completion_tokens: 32_768,
      });
    } catch {
      completion = await client.chat.completions.create({
        ...baseBody,
        max_tokens: 16_384,
      } as never);
    }
  }
  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  return AiPayloadSchema.parse(JSON.parse(raw));
}

function mostlyAllWithdrawals(rows: ParsedImportRow[]): boolean {
  if (rows.length < 8) return false;
  const withAmt = rows.filter((r) => r.moneyIn > 0 || r.moneyOut > 0);
  if (withAmt.length < 8) return false;
  const deposits = withAmt.filter((r) => r.moneyIn > 0).length;
  return deposits / withAmt.length < 0.08;
}

async function extractWithValidation(
  userContent: Array<
    | { type: "text"; text: string }
    | { type: "file"; file: { filename: string; file_data: string } }
  >,
  source: AiExtractResult["source"],
): Promise<AiExtractResult> {
  let payload = await callJsonModel(userContent, false);
  let normalized = normalizeRows(payload);
  const total = payload.transactions.length || 1;
  const needRetry =
    (normalized.invalidCount / total > INVALID_ROW_RETRY_RATIO &&
      normalized.rows.length < 3) ||
    mostlyAllWithdrawals(normalized.rows);

  if (needRetry) {
    payload = await callJsonModel(userContent, true);
    normalized = normalizeRows(payload);
  }
  return {
    rows: normalized.rows,
    bankHint: toBankHint(payload),
    warnings: normalized.warnings,
    source,
  };
}

/** Text-only fallback (layout often scrambled — prefer PDF file path). */
export async function extractStatementFromPdfText(
  text: string,
  fileName: string,
): Promise<AiExtractResult> {
  const clipped =
    text.length > MAX_TEXT_CHARS
      ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[TRUNCATED — continue only with visible content above]`
      : text;
  return extractWithValidation(
    [
      {
        type: "text",
        text: `File: ${fileName}\n\nExtract every posted Canadian bank/credit-card transaction. Use Withdrawals vs Deposits + Balance. Do not mark deposits as withdrawals.\n\n${clipped}`,
      },
    ],
    "openai-text",
  );
}

/**
 * ChatGPT-style: send the actual PDF so the model sees column layout.
 * Optional textHint helps with searchable PDFs that also have a text layer.
 */
export async function extractStatementFromPdfFile(
  buffer: Buffer,
  fileName: string,
  opts?: { textHint?: string },
): Promise<AiExtractResult> {
  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new Error("PDF is too large for AI extract (max 20MB). Split the file or export CSV.");
  }
  const b64 = buffer.toString("base64");
  const hint =
    opts?.textHint?.trim() &&
    `Searchable text layer (may scramble columns — TRUST THE PDF LAYOUT for Withdrawals vs Deposits):\n${opts.textHint.trim().slice(0, 24_000)}`;

  return extractWithValidation(
    [
      {
        type: "file",
        file: {
          filename: fileName,
          file_data: `data:application/pdf;base64,${b64}`,
        },
      },
      {
        type: "text",
        text: [
          `File: ${fileName}`,
          "Read this Canadian bank/credit-card statement PDF like ChatGPT: all pages, correct Withdrawals(moneyOut) vs Deposits(moneyIn), full descriptions, opening/closing summary.",
          "Return balanceAfter on every posted line when printed.",
          hint || "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    "openai-vision",
  );
}

/** Heuristic often mis-parses Canadian statements (years as amounts, header fragments). */
export function localRowsLookUnreliable(
  rows: Array<{ date: Date; description: string; moneyIn: number; moneyOut: number }>,
): boolean {
  if (!rows.length) return true;
  const yearNow = new Date().getFullYear();
  let bad = 0;
  for (const row of rows) {
    const amount = row.moneyIn || row.moneyOut;
    const desc = row.description.trim();
    const y = row.date.getFullYear();
    if (amount >= 1900 && amount <= 2100 && Number.isInteger(amount)) bad += 1;
    else if (desc.length < 4) bad += 1;
    else if (/^(for|to|the|period|ending|from|and|,|\.|page)\b/i.test(desc)) bad += 1;
    else if (y < 1990 || y > yearNow + 1) bad += 1;
  }
  return bad / rows.length >= 0.35 || (rows.length <= 5 && bad >= 2);
}

export function shouldUseOpenAiFallback(opts: {
  localRowCount: number;
  textLength: number;
  localRows?: Array<{ date: Date; description: string; moneyIn: number; moneyOut: number }>;
  hasApiKey?: boolean;
}): boolean {
  if (opts.localRowCount === 0) return true;
  if (opts.localRows && localRowsLookUnreliable(opts.localRows)) return true;
  if (opts.textLength >= 800 && opts.localRowCount < 3) return true;
  if (opts.hasApiKey && opts.textLength >= 400) return true;
  return false;
}
