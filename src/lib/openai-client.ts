import OpenAI from "openai";

let client: OpenAI | null = null;
let clientKey: string | null = null;

export function getOpenAiApiKey(): string | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key || null;
}

/** Default: gpt-4o-mini — widely available, vision+JSON, cheap for statement extract. */
export function getOpenAiPdfModel(): string {
  return process.env.OPENAI_PDF_MODEL?.trim() || "gpt-4o-mini";
}

export function getOpenAI(): OpenAI | null {
  const key = getOpenAiApiKey();
  if (!key) return null;
  if (!client || clientKey !== key) {
    client = new OpenAI({ apiKey: key });
    clientKey = key;
  }
  return client;
}
