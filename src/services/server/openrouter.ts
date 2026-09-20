/**
 * Server-only OpenRouter REST adapter.
 *
 * Fallback correlation provider when AWS Bedrock is unavailable.
 * Uses the OpenRouter chat completions API with server-side-only credentials.
 * This module MUST never be imported from client components.
 */

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export type OpenRouterFailureKind =
  | "model_unavailable"
  | "access_denied"
  | "throttled"
  | "service_unavailable"
  | "invalid_request"
  | "network"
  | "unknown";

export class OpenRouterRuntimeError extends Error {
  readonly kind: OpenRouterFailureKind;

  constructor(kind: OpenRouterFailureKind, message: string) {
    super(message);
    this.name = "OpenRouterRuntimeError";
    this.kind = kind;
  }
}

export function isOpenRouterConfigured(): boolean {
  const apiKey = process.env.OPENROUTER_API_KEY;
  return typeof apiKey === "string" && apiKey.trim().length > 0;
}

export function configuredOpenRouterModelId(): string {
  const modelId = process.env.FRAUDFIRST_OPENROUTER_MODEL_ID;
  if (typeof modelId === "string" && modelId.trim().length > 0) {
    return modelId.trim();
  }
  return "meta-llama/llama-4-maverick";
}

export interface OpenRouterConverseInput {
  systemPrompt: string;
  userPrompt: string;
}

function classifyOpenRouterError(
  status: number,
  body: Record<string, unknown> | null
): OpenRouterRuntimeError {
  const errorObj = body?.error as
    | { message?: string; code?: number }
    | undefined;
  const message = errorObj?.message ?? "";

  if (status === 404 || message.toLowerCase().includes("model not found")) {
    return new OpenRouterRuntimeError(
      "model_unavailable",
      "The configured model is not available on OpenRouter."
    );
  }
  if (status === 401 || status === 403) {
    return new OpenRouterRuntimeError(
      "access_denied",
      "OpenRouter API key is invalid or access was denied."
    );
  }
  if (status === 429) {
    return new OpenRouterRuntimeError(
      "throttled",
      "OpenRouter request was rate-limited. Try again shortly."
    );
  }
  if (status >= 500) {
    return new OpenRouterRuntimeError(
      "service_unavailable",
      "OpenRouter is temporarily unavailable. Try again."
    );
  }
  if (status === 400 || status === 422) {
    return new OpenRouterRuntimeError(
      "invalid_request",
      "The request was rejected by OpenRouter."
    );
  }
  return new OpenRouterRuntimeError(
    "unknown",
    `OpenRouter request failed (${status}).`
  );
}

function extractResponseText(
  data: Record<string, unknown>
): string {
  const choices = data.choices as
    | Array<{ message?: { content?: string } }>
    | undefined;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const content = choices[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

export async function converseOpenRouter(
  input: OpenRouterConverseInput
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OpenRouterRuntimeError(
      "access_denied",
      "OpenRouter API key is not configured."
    );
  }

  const modelId = configuredOpenRouterModelId();

  let response: Response;
  try {
    response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "X-Title": "FraudFirst",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
        temperature: 0,
        max_tokens: 4096,
      }),
    });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : String(error);
    if (msg.includes("fetch") || msg.includes("network") || msg.includes("timeout")) {
      throw new OpenRouterRuntimeError("network", "The OpenRouter request timed out.");
    }
    throw new OpenRouterRuntimeError("unknown", "The OpenRouter request failed.");
  }

  if (!response.ok) {
    let body: Record<string, unknown> | null = null;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      // ignore parse failure
    }
    throw classifyOpenRouterError(response.status, body);
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new OpenRouterRuntimeError(
      "service_unavailable",
      "OpenRouter returned an unreadable response."
    );
  }

  const text = extractResponseText(data);
  if (text.length === 0) {
    throw new OpenRouterRuntimeError(
      "service_unavailable",
      "The model returned no output."
    );
  }

  return text;
}
