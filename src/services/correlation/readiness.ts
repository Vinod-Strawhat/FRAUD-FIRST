import type {
  EvidenceRecord,
  EvidenceCorrelationReadinessState,
} from "@/types";

/**
 * Deterministic correlation readiness model.
 *
 * This module is PURE: it imports no AWS SDK, no node built-ins, and no
 * server-only services, so it can be reused by both the server orchestration
 * layer and the browser UI. Readiness is derived only from evidence metadata
 * plus whether usable extracted text is currently available for a given
 * evidence item. It never treats "unsupported media", "no extracted text",
 * or a client-fabricated claim on un-processed evidence as successful
 * extraction: only evidence that has genuinely reached the "processed" state
 * with a real extraction meta can ever be correlation-ready.
 */

const EXTRACTABLE_MIME_TYPES = new Set(["image/png", "image/jpeg"]);

export function isExtractionSupportedMime(mimeType: string): boolean {
  return EXTRACTABLE_MIME_TYPES.has(mimeType);
}

export interface EvidenceCorrelationReadiness {
  state: EvidenceCorrelationReadinessState;
  reason: string;
  /** Usable text for correlation, present only in the "ready" state. */
  text?: string;
}

export interface ReadinessEvidenceClaim {
  text?: string;
}

/**
 * Classify one evidence item's readiness for incident-level correlation.
 * `claim` carries extracted text held in the current browser session for a
 * previously processed item; when Textract is unavailable this is the only
 * server-side usable text source until preservation-based re-extraction is
 * available.
 */
export function deriveEvidenceReadiness(
  record: Pick<
    EvidenceRecord,
    "status" | "mimeType" | "extraction" | "storage"
  >,
  claim?: ReadinessEvidenceClaim
): EvidenceCorrelationReadiness {
  const mimeType = record.mimeType;

  if (!isExtractionSupportedMime(mimeType)) {
    const reason =
      mimeType === "application/pdf"
        ? "PDF text extraction is not supported yet."
        : mimeType === "image/webp"
          ? "WebP isn't supported by the text extraction service yet."
          : "This file type cannot have its text extracted.";
    return { state: "unsupported_media", reason };
  }

  if (record.status === "processing") {
    return {
      state: "processing",
      reason: "Text extraction is still in progress.",
    };
  }

  if (record.status === "failed") {
    return {
      state: "extraction_failed",
      reason: "Text extraction failed for this file.",
    };
  }

  if (
    record.status === "processed" &&
    record.extraction &&
    claim &&
    typeof claim.text === "string" &&
    claim.text.trim().length > 0
  ) {
    return {
      state: "ready",
      reason: "Extracted text is available for correlation.",
      text: claim.text,
    };
  }

  if (
    record.status === "processed" &&
    record.extraction &&
    typeof record.extraction.textLength === "number"
  ) {
    if (record.extraction.textLength === 0) {
      return {
        state: "no_text_found",
        reason: "No readable text was found in this file.",
      };
    }
    if (record.storage?.status === "preserved") {
      return {
        state: "preserved_extraction_unavailable",
        reason:
          "The original is preserved, but its extracted text isn't available " +
          "right now. Re-extract the text in this session (or once text " +
          "extraction is available) before correlating.",
      };
    }
    return {
      state: "text_unavailable",
      reason:
        "Extracted text from an earlier session isn't retained, and no " +
        "preserved original exists to re-extract from.",
    };
  }

  if (record.status === "captured" && record.storage?.status === "preserved") {
    return {
      state: "not_extracted",
      reason: "Original preserved, but its text has not been extracted yet.",
    };
  }

  return {
    state: "not_extracted",
    reason: "Evidence captured but not preserved or processed.",
  };
}