import OpenAI from "openai";

let client: OpenAI | null = null;
let clientFingerprint: string | null = null;

export function getOpenAiApiKey(): string | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key || null;
}

/**
 * Optional override. Use for OpenRouter:
 *   OPENAI_BASE_URL=https://openrouter.ai/api/v1
 * Auto-set when the key looks like an OpenRouter key (sk-or-...).
 */
export function getOpenAiBaseUrl(): string | undefined {
  const explicit = process.env.OPENAI_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const key = getOpenAiApiKey();
  if (key?.startsWith("sk-or-")) return "https://openrouter.ai/api/v1";
  return undefined;
}

export function isOpenRouter(): boolean {
  return Boolean(getOpenAiBaseUrl()?.includes("openrouter.ai"));
}

/**
 * Default: gpt-4o-mini (OpenAI) / openai/gpt-4o-mini (OpenRouter).
 * Luna on OpenRouter: openai/gpt-6-luna
 */
export function getOpenAiPdfModel(): string {
  const configured = process.env.OPENAI_PDF_MODEL?.trim();
  if (configured) return configured;
  return isOpenRouter() ? "openai/gpt-4o-mini" : "gpt-4o-mini";
}

export function getOpenAI(): OpenAI | null {
  const key = getOpenAiApiKey();
  if (!key) return null;
  const baseURL = getOpenAiBaseUrl();
  const fingerprint = `${key}|${baseURL ?? ""}`;
  if (!client || clientFingerprint !== fingerprint) {
    client = new OpenAI({
      apiKey: key,
      ...(baseURL ? { baseURL } : {}),
      ...(baseURL?.includes("openrouter.ai")
        ? {
            defaultHeaders: {
              "HTTP-Referer":
                process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000",
              "X-Title": "LedgerDesk",
            },
          }
        : {}),
    });
    clientFingerprint = fingerprint;
  }
  return client;
}
