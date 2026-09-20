import {
  ExtractionServiceError,
  extractImageBytesWithMime,
  MAX_EVIDENCE_BYTES,
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_IMAGE_MIME_TYPES,
} from "@/services/extraction";
import type {
  EvidenceExtractionResult,
  ExtractEvidenceResponse,
  ExtractionError,
  ExtractionErrorCode,
} from "@/types";

export const dynamic = "force-dynamic";

const INCIDENT_ID_RE = /^FF-\d{8}-[A-Z2-9]{4}$/;
const EVIDENCE_ID_RE = /^ev_[A-Za-z0-9_-]+$/;

function fileExtension(filename: string): string | null {
  const index = filename.lastIndexOf(".");
  if (index < 0) return null;
  return filename.slice(index).toLowerCase();
}

function isSupportedMime(mimeType: string): boolean {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

function isSupportedExtension(filename: string): boolean {
  return (SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(
    fileExtension(filename) ?? ""
  );
}

function errorBody(code: ExtractionErrorCode, message: string): ExtractionError {
  return { code, message };
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      {
        ok: false,
        error: errorBody("INVALID_REQUEST", "The request could not be read."),
      } satisfies ExtractEvidenceResponse,
      { status: 400 }
    );
  }

  const incidentId = form.get("incidentId");
  const evidenceId = form.get("evidenceId");
  const file = form.get("file");

  if (typeof incidentId !== "string" || typeof evidenceId !== "string") {
    return Response.json(
      {
        ok: false,
        error: errorBody("MISSING_FIELD", "incidentId and evidenceId are required."),
      } satisfies ExtractEvidenceResponse,
      { status: 400 }
    );
  }

  if (!INCIDENT_ID_RE.test(incidentId)) {
    return Response.json(
      {
        ok: false,
        error: errorBody("INCIDENT_NOT_FOUND", "The incident id is not valid."),
      } satisfies ExtractEvidenceResponse,
      { status: 400 }
    );
  }

  if (!EVIDENCE_ID_RE.test(evidenceId)) {
    return Response.json(
      {
        ok: false,
        error: errorBody("EVIDENCE_NOT_FOUND", "The evidence id is not valid."),
      } satisfies ExtractEvidenceResponse,
      { status: 400 }
    );
  }

  if (!(file instanceof File)) {
    return Response.json(
      {
        ok: false,
        error: errorBody("FILE_REQUIRED", "A file is required."),
      } satisfies ExtractEvidenceResponse,
      { status: 400 }
    );
  }

  const mimeType = file.type || "application/octet-stream";
  const isImage = isSupportedMime(mimeType) || isSupportedExtension(file.name);

  if (!isImage) {
    return Response.json(
      {
        ok: false,
        error: errorBody("UNSUPPORTED_MEDIA_TYPE", "This file type is not supported for text extraction."),
      } satisfies ExtractEvidenceResponse,
      { status: 415 }
    );
  }

  if (file.size > MAX_EVIDENCE_BYTES) {
    return Response.json(
      {
        ok: false,
        error: errorBody(
          "FILE_TOO_LARGE",
          "The file is larger than the 5 MB extraction limit."
        ),
      } satisfies ExtractEvidenceResponse,
      { status: 413 }
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return Response.json(
      {
        ok: false,
        error: errorBody("FILE_NOT_READABLE", "The file could not be read."),
      } satisfies ExtractEvidenceResponse,
      { status: 400 }
    );
  }

  try {
    const extracted = await extractImageBytesWithMime(bytes, mimeType);
    const result: EvidenceExtractionResult = {
      evidenceId,
      status: "processed",
      text: extracted.text,
      confidence: extracted.confidence,
      source: extracted.source,
      extractedAt: extracted.extractedAt,
      provider: extracted.providerMeta.provider as "textract" | "tesseract",
      providerMode: extracted.providerMeta.providerMode as "primary" | "fallback",
    };
    return Response.json(
      {
        ok: true,
        evidenceId,
        status: "processed",
        extraction: result,
      } satisfies ExtractEvidenceResponse,
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof ExtractionServiceError) {
      const status = error.code === "FILE_TOO_LARGE" ? 413 : 422;
      console.log("[EXTRACT-DIAG] Route returning error", { code: error.code, message: error.message, status });
      return Response.json(
        {
          ok: false,
          error: error.toError(),
        } satisfies ExtractEvidenceResponse,
        { status }
      );
    }
    console.log("[EXTRACT-DIAG] Route returning unexpected error", {
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      {
        ok: false,
        error: errorBody(
          "EXTRACTION_FAILED",
          "Text extraction failed. Please try again."
        ),
      } satisfies ExtractEvidenceResponse,
      { status: 500 }
    );
  }
}
