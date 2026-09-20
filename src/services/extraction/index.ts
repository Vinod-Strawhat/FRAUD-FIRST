import { extractWithFallback } from "@/services/providers/extract";
import type {
  ExtractedText,
  ExtractionError,
  ExtractionErrorCode,
} from "@/types";

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
] as const;

export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

export const SUPPORTED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg"] as const;

export class ExtractionServiceError extends Error {
  readonly code: ExtractionErrorCode;

  constructor(code: ExtractionErrorCode, message: string) {
    super(message);
    this.name = "ExtractionServiceError";
    this.code = code;
  }

  toError(): ExtractionError {
    return { code: this.code, message: this.message };
  }
}

export async function extractImageBytes(
  bytes: Uint8Array
): Promise<ExtractedText> {
  try {
    const result = await extractWithFallback(bytes, "image/png");
    return {
      text: result.text,
      confidence: result.confidence,
      source: result.source,
      extractedAt: result.extractedAt,
    };
  } catch (error) {
    if (error instanceof ExtractionServiceError) throw error;
    throw new ExtractionServiceError(
      "EXTRACTION_FAILED",
      "Text extraction failed. Please try again."
    );
  }
}

export async function extractImageBytesWithMime(
  bytes: Uint8Array,
  mimeType: string
): Promise<ExtractedText & { providerMeta: { provider: string; providerMode: string } }> {
  try {
    return await extractWithFallback(bytes, mimeType);
  } catch (error) {
    if (error instanceof ExtractionServiceError) throw error;
    throw new ExtractionServiceError(
      "EXTRACTION_FAILED",
      "Text extraction failed. Please try again."
    );
  }
}
