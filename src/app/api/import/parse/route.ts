import { NextResponse } from "next/server";
import { PDFParse } from "@/lib/pdf-parse";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isOfxOrQboFileName, parseOfxOrQbo } from "@/lib/ofx-parser";
import { parseMatrixFromAoa, type ParsedImportRow } from "@/lib/import-parser";
import { parseStatementText } from "@/lib/statement-text";
import { parseBankXml } from "@/lib/xml-parser";
import { getOpenAiApiKey } from "@/lib/openai-client";
import {
  extractStatementFromPdfFile,
  extractStatementFromPdfText,
  shouldUseOpenAiFallback,
  type BankHint,
} from "@/lib/openai-statement-extract";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_PDF_PAGES = 40;

function mapRows(rows: ParsedImportRow[]) {
  return rows.map((row) => ({
    date: row.date.toISOString(),
    description: row.description,
    moneyIn: row.moneyIn,
    moneyOut: row.moneyOut,
    notes: row.notes,
    externalTransactionId: row.externalTransactionId,
  }));
}

function jsonResult(opts: {
  format: string;
  fileName: string;
  rows: ParsedImportRow[];
  errors?: string[];
  warnings?: string[];
  source: string;
  bankHint?: BankHint | null;
}) {
  return NextResponse.json({
    format: opts.format,
    fileName: opts.fileName,
    rows: mapRows(opts.rows),
    errors: opts.errors ?? [],
    warnings: opts.warnings ?? [],
    source: opts.source,
    bankHint: opts.bankHint ?? null,
  });
}

export async function POST(request: Request) {
  let session;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File is required" }, { status: 400 });
  }

  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    if (name.endsWith(".pdf")) {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        let rows: ParsedImportRow[] = [];
        let errors: string[] = [];
        let source: string = "local-text";
        let text = "";
        let pageCount = 0;

        try {
          const tableResult = await parser.getTable();
          pageCount = tableResult.pages?.length ?? 0;
          const tableRows: ParsedImportRow[] = [];
          for (const page of tableResult.pages) {
            for (const table of page.tables) {
              if (!table?.length) continue;
              tableRows.push(...parseMatrixFromAoa(table, file.name).rows);
            }
          }
          if (tableRows.length) {
            rows = tableRows;
            source = "local-table";
          }
        } catch {
          // Table detection is best-effort; fall back to plain text.
        }

        const textResult = await parser.getText();
        text = textResult.text ?? "";
        if (!pageCount) {
          pageCount = Math.max(1, Number((textResult as { total?: number }).total) || 1);
        }

        if (!rows.length) {
          const parsed = parseStatementText(text);
          rows = parsed.rows;
          errors = parsed.errors;
          source = "local-text";
        }

        const needAi = shouldUseOpenAiFallback({
          localRowCount: rows.length,
          textLength: text.trim().length,
          localRows: rows,
          hasApiKey: Boolean(getOpenAiApiKey()),
        });

        if (needAi) {
          if (pageCount > MAX_PDF_PAGES) {
            return NextResponse.json(
              {
                error: `PDF has too many pages (${pageCount}). Max ${MAX_PDF_PAGES} for AI import — split the PDF or export CSV from your bank.`,
              },
              { status: 400 },
            );
          }
          if (!getOpenAiApiKey()) {
            // Prefer empty over garbage heuristic rows when AI would have been used.
            return NextResponse.json(
              {
                error:
                  "This bank PDF needs AI extract (local parse is unreliable for this format). Add OPENAI_API_KEY to ledgerdesk/.env, restart the dev server, then try again — or import CSV/Excel from your bank.",
                rows: [],
                source: "local-unreliable",
              },
              { status: 422 },
            );
          }

          try {
            // Prefer PDF bytes (ChatGPT-style layout) — text-only scrambles Withdrawals/Deposits columns.
            const ai =
              buffer.byteLength > 0
                ? await extractStatementFromPdfFile(buffer, file.name, {
                    textHint: text.trim().length >= 200 ? text : undefined,
                  })
                : await extractStatementFromPdfText(text, file.name);

            console.info("[import/parse]", {
              file: file.name,
              source: ai.source,
              pages: pageCount,
              rows: ai.rows.length,
              bank: ai.bankHint.institutionName,
            });

            if (!ai.rows.length) {
              return NextResponse.json(
                {
                  error:
                    ai.warnings[0] ??
                    "AI finished but found no posted transactions. Try CSV/Excel from your bank.",
                  rows: [],
                  source: ai.source,
                  bankHint: ai.bankHint,
                  warnings: ai.warnings,
                },
                { status: 422 },
              );
            }

            return jsonResult({
              format: "pdf-ai",
              fileName: file.name,
              rows: ai.rows,
              warnings: ai.warnings,
              source: ai.source,
              bankHint: ai.bankHint,
            });
          } catch (aiErr) {
            console.error("[import/parse] OpenAI extract failed", aiErr);
            const message =
              aiErr instanceof Error ? aiErr.message : "AI PDF extract failed";
            if (rows.length) {
              return jsonResult({
                format: "pdf",
                fileName: file.name,
                rows,
                errors: [...errors, `AI fallback failed: ${message}`],
                source,
              });
            }
            return NextResponse.json({ error: message }, { status: 500 });
          }
        }

        console.info("[import/parse]", {
          file: file.name,
          source,
          pages: pageCount,
          rows: rows.length,
        });

        return jsonResult({
          format: "pdf",
          fileName: file.name,
          rows,
          errors,
          source,
        });
      } finally {
        await parser.destroy();
      }
    }

    const text = buffer.toString("utf8");

    if (name.endsWith(".xml") || name.endsWith(".camt")) {
      const parsed = parseBankXml(text);
      return jsonResult({
        format: "xml",
        fileName: file.name,
        rows: parsed.rows,
        errors: parsed.errors,
        source: "xml",
      });
    }

    if (isOfxOrQboFileName(name) || name.endsWith(".qfx")) {
      const parsed = parseOfxOrQbo(text);
      return jsonResult({
        format: "ofx",
        fileName: file.name,
        rows: parsed.rows,
        errors: parsed.errors,
        source: "ofx",
      });
    }

    return NextResponse.json(
      { error: "Unsupported format for server parse. Use PDF, XML, OFX, QBO, or QFX." },
      { status: 400 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Parse failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
