/**
 * Extraction provider selection with Textract → Tesseract fallback.
 *
 * Attempts AWS Textract first. If Textract fails due to provider
 * unavailability (SubscriptionRequiredException, not-configured, etc.),
 * falls back to Tesseract OCR. Other errors (invalid input, too large,
 * programming bugs) are NOT eligible for fallback.
 */

import {
  extractImageText,
  isAwsConfigured,
} from "@/services/extraction/textract";
import { extractWithTesseract, isTesseractSupported } from "@/services/extraction/tesseract";
import { ExtractionServiceError } from "@/services/extraction/index";
import type { ExtractedText } from "@/types";
import type { ExtractionProviderMeta } from "@/services/providers/types";

export interface ExtractionResultWithProvider extends ExtractedText {
  providerMeta: ExtractionProviderMeta;
}

function isFallbackEligibleError(error: unknown): boolean {
  if (error instanceof ExtractionServiceError) {
    return error.code === "AWS_NOT_CONFIGURED";
  }
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  const combined = `${name} ${message}`.toLowerCase();
  return (
    combined.includes("subscriptionrequired") ||
    combined.includes("not configured") ||
    combined.includes("accessdenied") ||
    combined.includes("invalidcredentials")
  );
}

export async function extractWithFallback(
  bytes: Uint8Array,
  mimeType: string
): Promise<ExtractionResultWithProvider> {
  const awsConfigured = isAwsConfigured();
  console.log("[EXTRACT-DIAG] extractWithFallback called", { mimeType, bytesLength: bytes.length, awsConfigured });

  if (!awsConfigured) {
    console.log("[EXTRACT-DIAG] AWS not configured → direct Tesseract fallback");
    return extractWithTesseractFallback(bytes, mimeType, null);
  }

  try {
    console.log("[EXTRACT-DIAG] Attempting Textract primary...");
    const result = await extractImageText({ bytes });
    console.log("[EXTRACT-DIAG] Textract succeeded", { textLength: result.text.length, confidence: result.confidence });
    return {
      text: result.text,
      confidence: result.confidence,
      source: "aws-textract",
      extractedAt: new Date().toISOString(),
      providerMeta: { provider: "textract", providerMode: "primary" },
    };
  } catch (textractError) {
    const eligible = isFallbackEligibleError(textractError);
    console.log("[EXTRACT-DIAG] Textract failed", {
      errorName: textractError instanceof Error ? textractError.name : typeof textractError,
      errorMessage: textractError instanceof Error ? textractError.message : String(textractError),
      fallbackEligible: eligible,
    });
    if (!eligible) {
      throw textractError;
    }
    return extractWithTesseractFallback(bytes, mimeType, textractError);
  }
}

async function extractWithTesseractFallback(
  bytes: Uint8Array,
  mimeType: string,
  originalError: unknown
): Promise<ExtractionResultWithProvider> {
  const supported = isTesseractSupported(mimeType);
  console.log("[EXTRACT-DIAG] extractWithTesseractFallback", { mimeType, tesseractSupported: supported, hasOriginalError: originalError !== null });
  if (!supported) {
    if (originalError instanceof ExtractionServiceError) {
      throw originalError;
    }
    throw new ExtractionServiceError(
      "UNSUPPORTED_MEDIA_TYPE",
      "This file type is not supported for text extraction."
    );
  }

  try {
    console.log("[EXTRACT-DIAG] Calling Tesseract OCR...");
    const result = await extractWithTesseract(bytes, mimeType);
    console.log("[EXTRACT-DIAG] Tesseract succeeded", { textLength: result.text.length, confidence: result.confidence });
    return {
      text: result.text,
      confidence: result.confidence,
      source: "tesseract",
      extractedAt: new Date().toISOString(),
      providerMeta: { provider: "tesseract", providerMode: "fallback" },
    };
  } catch (tesseractError) {
    console.log("[EXTRACT-DIAG] Tesseract failed", {
      errorName: tesseractError instanceof Error ? tesseractError.name : typeof tesseractError,
      errorMessage: tesseractError instanceof Error ? tesseractError.message : String(tesseractError),
      stack: tesseractError instanceof Error ? tesseractError.stack?.split("\n").slice(0, 5).join("\n") : undefined,
    });
    if (originalError instanceof ExtractionServiceError) {
      throw originalError;
    }
    throw new ExtractionServiceError(
      "EXTRACTION_FAILED",
      "Text extraction failed. Please try again."
    );
  }
}
