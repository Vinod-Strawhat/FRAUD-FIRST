import { CorrelationServiceError } from "./error";
import { isBedrockConfigured } from "@/services/server/bedrock";
import { isOpenRouterConfigured } from "@/services/server/openrouter";
import {
  correlateEvidenceWithFallback,
  type CorrelateEvidenceBatchItemInput as ProviderBatchItemInput,
  type CorrelateEvidenceTextResultWithProvider,
} from "@/services/providers/correlate";
import type {
  CorrelationAnalysis,
  CorrelationProviderMode,
  CorrelationProviderName,
} from "@/types";

export { CorrelationServiceError } from "./error";

/**
 * Correlation layer: evidence-derived text in, traceable structured facts
 * out. This service is server-only and never bundled for the client.
 *
 * The extracted evidence text is treated as UNTRUSTED DATA. It is only ever
 * placed inside the evidence block of the user prompt; it can never override
 * the system instructions.
 */

export const CORRELATION_MAX_SENT_CHARS = 24_000;
export const CORRELATION_HARD_LIMIT_CHARS = 60_000;
export const CORRELATION_BATCH_MAX_ITEMS = 50;
export const CORRELATION_BATCH_TOTAL_CHARS = 100_000;

export interface CorrelateEvidenceTextInput {
  incidentId: string;
  evidenceId: string;
  filename: string;
  mimeType: string;
  category: string;
  capturedAt?: string;
  extractedAt?: string;
  status?: "processed";
  text: string;
}

export interface CorrelateEvidenceBatchItemInput {
  incidentId: string;
  evidenceId: string;
  filename: string;
  mimeType: string;
  category: string;
  capturedAt?: string;
  extractedAt?: string;
  source?: string;
  confidence?: number;
  status?: "processed";
  text: string;
}

export interface CorrelateEvidenceTextResult {
  modelId: string;
  durationMs: number;
  textLength: number;
  analysis: CorrelationAnalysis;
  provider: CorrelationProviderName;
  providerMode: CorrelationProviderMode;
}

export function assertCorrelationConfigured(): void {
  if (!isBedrockConfigured() && !isOpenRouterConfigured()) {
    throw new CorrelationServiceError(
      "BEDROCK_NOT_CONFIGURED",
      "AI correlation is not configured for this environment."
    );
  }
}

export async function correlateEvidenceText(
  input: CorrelateEvidenceTextInput
): Promise<CorrelateEvidenceTextResult> {
  return correlateEvidenceBatch([input]);
}

function toProviderItem(
  item: CorrelateEvidenceBatchItemInput
): ProviderBatchItemInput {
  return {
    incidentId: item.incidentId,
    evidenceId: item.evidenceId,
    filename: item.filename,
    mimeType: item.mimeType,
    category: item.category,
    capturedAt: item.capturedAt,
    extractedAt: item.extractedAt,
    source: item.source,
    confidence: item.confidence,
    status: item.status,
    text: item.text,
  };
}

export async function correlateEvidenceBatch(
  items: CorrelateEvidenceBatchItemInput[]
): Promise<CorrelateEvidenceTextResult> {
  if (items.length === 0) {
    throw new CorrelationServiceError(
      "INVALID_REQUEST",
      "No evidence was provided for correlation."
    );
  }
  if (items.length > CORRELATION_BATCH_MAX_ITEMS) {
    throw new CorrelationServiceError(
      "INVALID_REQUEST",
      "Too many evidence items for a single correlation run."
    );
  }
  for (const item of items) {
    if (item.text.length > CORRELATION_HARD_LIMIT_CHARS) {
      throw new CorrelationServiceError(
        "INVALID_REQUEST",
        "One of the evidence items exceeds the supported correlation size limit."
      );
    }
  }
  const totalCharacters = items.reduce(
    (sum, item) => sum + item.text.length,
    0
  );
  if (totalCharacters > CORRELATION_BATCH_TOTAL_CHARS) {
    throw new CorrelationServiceError(
      "INVALID_REQUEST",
      "The combined extracted text exceeds the supported correlation size limit."
    );
  }

  const providerItems = items.map(toProviderItem);
  const result: CorrelateEvidenceTextResultWithProvider =
    await correlateEvidenceWithFallback(providerItems);

  return {
    modelId: result.modelId,
    durationMs: result.durationMs,
    textLength: result.textLength,
    analysis: result.analysis,
    provider: result.provider,
    providerMode: result.providerMode,
  };
}
