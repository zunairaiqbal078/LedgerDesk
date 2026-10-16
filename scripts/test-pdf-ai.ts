/**
 * Offline/local PDF extract smoke test against reference statements.
 * Usage:
 *   pnpm exec tsx scripts/test-pdf-ai.ts
 *   OPENAI_API_KEY=sk-... pnpm exec tsx scripts/test-pdf-ai.ts --ai
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { PDFParse } from "../src/lib/pdf-parse";
import { parseMatrixFromAoa } from "../src/lib/import-parser";
import { parseStatementText } from "../src/lib/statement-text";
import {
  extractStatementFromPdfFile,
  extractStatementFromPdfText,
  shouldUseOpenAiFallback,
} from "../src/lib/openai-statement-extract";
import { getOpenAiApiKey } from "../src/lib/openai-client";

const ROOT = path.resolve(__dirname, "../..");
const useAi = process.argv.includes("--ai");

async function localExtract(filePath: string) {
  const buf = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    let rows: ReturnType<typeof parseStatementText>["rows"] = [];
    let source = "local-text";
    try {
      const tableResult = await parser.getTable();
      for (const page of tableResult.pages) {
        for (const table of page.tables) {
          if (!table?.length) continue;
          rows.push(...parseMatrixFromAoa(table, path.basename(filePath)).rows);
        }
      }
      if (rows.length) source = "local-table";
    } catch {
      /* ignore */
    }
    const textResult = await parser.getText();
    const text = textResult.text ?? "";
    if (!rows.length) {
      rows = parseStatementText(text).rows;
    }
    return { rows, text, source, buffer: buf };
  } finally {
    await parser.destroy();
  }
}

async function main() {
  const pdfs = fs
    .readdirSync(ROOT)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort();

  console.log(`Found ${pdfs.length} PDFs in ${ROOT}`);
  console.log(`AI mode: ${useAi ? "ON" : "OFF (pass --ai to call OpenAI)"}\n`);

  for (const name of pdfs) {
    const filePath = path.join(ROOT, name);
    const local = await localExtract(filePath);
    const needAi = shouldUseOpenAiFallback({
      localRowCount: local.rows.length,
      textLength: local.text.trim().length,
      localRows: local.rows,
      hasApiKey: Boolean(getOpenAiApiKey()),
    });
    const needAiWithKey = shouldUseOpenAiFallback({
      localRowCount: local.rows.length,
      textLength: local.text.trim().length,
      localRows: local.rows,
      hasApiKey: true,
    });
    console.log("—".repeat(60));
    console.log(name);
    console.log(
      `  local=${local.source} rows=${local.rows.length} textLen=${local.text.length} needAi=${needAi} (withKey=${needAiWithKey})`,
    );
    if (local.rows[0]) {
      const r = local.rows[0];
      console.log(
        `  sample: ${r.date.toISOString().slice(0, 10)} | ${r.description.slice(0, 40)} | in=${r.moneyIn} out=${r.moneyOut}`,
      );
    }

    if (!useAi || !needAi) continue;
    if (!getOpenAiApiKey()) {
      console.log("  SKIP AI — OPENAI_API_KEY missing");
      continue;
    }
    try {
      const ai =
        local.text.trim().length >= 400
          ? await extractStatementFromPdfText(local.text, name)
          : await extractStatementFromPdfFile(local.buffer, name);
      console.log(
        `  AI=${ai.source} rows=${ai.rows.length} bank=${ai.bankHint.institutionName ?? "?"} type=${ai.bankHint.statementType ?? "?"}`,
      );
      if (ai.rows[0]) {
        const r = ai.rows[0];
        console.log(
          `  ai sample: ${r.date.toISOString().slice(0, 10)} | ${r.description.slice(0, 40)} | in=${r.moneyIn} out=${r.moneyOut}`,
        );
      }
      if (ai.warnings.length) console.log(`  warnings: ${ai.warnings.join("; ")}`);
    } catch (err) {
      console.log(`  AI ERROR: ${err instanceof Error ? err.message : err}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
