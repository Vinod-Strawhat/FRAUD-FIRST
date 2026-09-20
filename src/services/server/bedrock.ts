import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";

/**
 * Server-only Amazon Bedrock Runtime adapter.
 *
 * This module MUST never be imported from client components. It is only
 * reachable through server route handlers / server services. Credentials are
 * resolved from the runtime environment, never from the browser.
 */

export const BEDROCK_MODEL_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:\-]{1,127}$/;

export type BedrockFailureKind =
  | "model_unavailable"
  | "access_denied"
  | "throttled"
  | "service_unavailable"
  | "invalid_request"
  | "network"
  | "unknown";

/**
 * Where a Bedrock failure was detected.
 *
 * - "aws": the failure was classified from an error returned by the AWS SDK
 *   (Bedrock provider/service response).
 * - "internal": the failure was detected locally by this adapter (invalid
 *   local input, empty or malformed model output). These are application-side
 *   conditions, not provider responses.
 */
export type BedrockErrorSource = "aws" | "internal";

export class BedrockRuntimeError extends Error {
  readonly kind: BedrockFailureKind;
  readonly source: BedrockErrorSource;

  constructor(
    kind: BedrockFailureKind,
    message: string,
    source: BedrockErrorSource = "internal"
  ) {
    super(message);
    this.name = "BedrockRuntimeError";
    this.kind = kind;
    this.source = source;
  }
}

export function isBedrockConfigured(): boolean {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const hasRegion = Boolean(region);
  const hasStaticCredentials =
    Boolean(process.env.AWS_ACCESS_KEY_ID) &&
    Boolean(process.env.AWS_SECRET_ACCESS_KEY);
  const hasProfile = Boolean(process.env.AWS_PROFILE);
  const modelId = configuredBedrockModelId();
  return hasRegion && (hasStaticCredentials || hasProfile) && modelId !== null;
}

export function configuredBedrockModelId(): string | null {
  const modelId = process.env.FRAUDFIRST_BEDROCK_MODEL_ID;
  if (typeof modelId !== "string" || modelId.trim().length === 0) return null;
  const trimmed = modelId.trim();
  if (trimmed.length > 128) return null;
  if (!BEDROCK_MODEL_ID_RE.test(trimmed)) return null;
  return trimmed;
}

let bedrockClient: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    });
  }
  return bedrockClient;
}

export interface ConverseEvidenceInput {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
}

function classifyError(error: unknown): BedrockRuntimeError {
  const name =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "";
  const code =
    typeof error === "object" &&
    error !== null &&
    "Code" in error &&
    typeof (error as { Code?: unknown }).Code === "string"
      ? (error as { Code: string }).Code
      : "";

  const token = name || code;

  if (
    token.includes("ModelNotReady") ||
    token.includes("ModelTimeout") ||
    token.includes("ModelNotFound") ||
    token.includes("ResourceNotFound") ||
    token.includes("ModelError")
  ) {
    return new BedrockRuntimeError(
      "model_unavailable",
      "The configured model is not available for this request.",
      "aws"
    );
  }

  if (token.includes("AccessDenied") || token.includes("Unauthorized")) {
    return new BedrockRuntimeError(
      "access_denied",
      "Access to the configured model was denied.",
      "aws"
    );
  }

  if (
    token.includes("Throttl") ||
    token.includes("TooManyRequests") ||
    token.includes("ProvisionedThroughput")
  ) {
    return new BedrockRuntimeError(
      "throttled",
      "The model request was throttled. Try again shortly.",
      "aws"
    );
  }

  if (
    token.includes("ServiceUnavailable") ||
    token.includes("InternalServer") ||
    token.includes("InternalError")
  ) {
    return new BedrockRuntimeError(
      "service_unavailable",
      "The model service is temporarily unavailable.",
      "aws"
    );
  }

  if (
    token.includes("Validation") ||
    token.includes("InsufficientClientError") ||
    token.includes("Malformed")
  ) {
    return new BedrockRuntimeError(
      "invalid_request",
      "The model request was rejected.",
      "aws"
    );
  }

  if (
    token.includes("Timeout") ||
    token.includes("Network") ||
    token.includes("Socket") ||
    token.includes("RequestTimeout")
  ) {
    return new BedrockRuntimeError(
      "network",
      "The model request timed out.",
      "aws"
    );
  }

  return new BedrockRuntimeError("unknown", "The model request failed.", "aws");
}

function extractResponseText(output: ConverseCommandOutput): string {
  const content = output.output?.message?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const text = "text" in block ? block.text : undefined;
      return typeof text === "string" ? text : "";
    })
    .join("")
    .trim();
}

export async function converseEvidence(
  input: ConverseEvidenceInput
): Promise<string> {
  if (!BEDROCK_MODEL_ID_RE.test(input.modelId)) {
    throw new BedrockRuntimeError(
      "invalid_request",
      "The configured model id is invalid.",
      "internal"
    );
  }

  let response: ConverseCommandOutput;
  try {
    const command = new ConverseCommand({
      modelId: input.modelId,
      system: [{ text: input.systemPrompt }],
      messages: [
        {
          role: "user",
          content: [{ text: input.userPrompt }],
        },
      ],
      inferenceConfig: {
        maxTokens: 4096,
        temperature: 0,
        topP: 1,
      },
    });
    response = await getClient().send(command);
  } catch (error) {
    throw classifyError(error);
  }

  const text = extractResponseText(response);
  if (text.length === 0) {
    throw new BedrockRuntimeError(
      "service_unavailable",
      "The model returned no output.",
      "internal"
    );
  }

  const stopReason = response.stopReason;
  if (stopReason && stopReason !== "end_turn" && stopReason !== "stop_sequence") {
    throw new BedrockRuntimeError(
      "invalid_request",
      `The model stopped unexpectedly (${stopReason}).`,
      "internal"
    );
  }

  return text;
}