/**
 * Provider abstraction types for FraudFirst.
 *
 * Every extraction and correlation request identifies which provider handled
 * the request and whether it was the primary or fallback path.
 */

export type ExtractionProviderName = "textract" | "tesseract";
export type CorrelationProviderName = "bedrock" | "openrouter";
export type ProviderMode = "primary" | "fallback";
export type ProviderStatus =
  | "success"
  | "failed"
  | "not_configured"
  | "unavailable";

export interface ExtractionProviderMeta {
  provider: ExtractionProviderName;
  providerMode: ProviderMode;
}

export interface CorrelationProviderMeta {
  provider: CorrelationProviderName;
  providerMode: ProviderMode;
}
