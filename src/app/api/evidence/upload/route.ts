import {
  assertPreservationConfigured,
  computeSha256,
  PreservationServiceError,
  preserveEvidenceToS3,
  resolveEvidenceContentType,
  resolveEvidenceObjectKey,
} from "@/services/preservation";
import { MAX_PRESERVATION_BYTES } from "@/types";
import type {
  PreservationError,
  PreservationErrorCode,
  PreserveEvidenceResponse,
} from "@/types";

export const dynamic = "force-dynamic";

const INCIDENT_ID_RE = /^FF-\d{8}-[A-Z2-9]{4}$/;
const EVIDENCE_ID_RE = /^ev_[A-Za-z0-9_-]+$/;

interface EvidenceClaimRecord {
  id?: unknown;
  incidentId?: unknown;
  filename?: unknown;
  mimeType?: unknown;
  size?: unknown;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function errorBody(code: PreservationErrorCode, message: string): PreservationError {
  return { code, message };
}

function jsonResponse(
  body: PreserveEvidenceResponse,
  status: number
): Response {
  return Response.json(body, { status });
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: errorBody("INVALID_REQUEST", "The request could not be read."),
      },
      400
    );
  }

  const incidentId = form.get("incidentId");
  const evidenceId = form.get("evidenceId");
  const evidenceJson = form.get("evidence");
  const file = form.get("file");

  if (!isString(incidentId) || !isString(evidenceId) || !isString(evidenceJson)) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody(
          "MISSING_FIELD",
          "incidentId, evidenceId and evidence are required."
        ),
      },
      400
    );
  }

  if (!INCIDENT_ID_RE.test(incidentId)) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody("INCIDENT_NOT_FOUND", "The incident id is not valid."),
      },
      400
    );
  }

  if (!EVIDENCE_ID_RE.test(evidenceId)) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody("EVIDENCE_NOT_FOUND", "The evidence id is not valid."),
      },
      400
    );
  }

  let record: EvidenceClaimRecord;
  try {
    record = JSON.parse(evidenceJson) as EvidenceClaimRecord;
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: errorBody("INVALID_REQUEST", "The evidence payload is invalid."),
      },
      400
    );
  }

  if (record.id !== evidenceId || record.incidentId !== incidentId) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody(
          "EVIDENCE_INCIDENT_MISMATCH",
          "The evidence does not belong to this incident."
        ),
      },
      400
    );
  }

  if (!(file instanceof File)) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody("FILE_REQUIRED", "A file is required."),
      },
      400
    );
  }

  const fileMimeType = file.type || "application/octet-stream";
  const contentType = resolveEvidenceContentType(file.name, fileMimeType);

  if (!contentType) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody(
          "UNSUPPORTED_MEDIA_TYPE",
          "This file type is not supported for evidence preservation."
        ),
      },
      415
    );
  }

  if (file.size > MAX_PRESERVATION_BYTES) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody(
          "FILE_TOO_LARGE",
          "The file is larger than the 5 MB preservation limit."
        ),
      },
      413
    );
  }

  if (isFiniteNumber(record.size) && record.size !== file.size) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody(
          "INVALID_FILE",
          "The uploaded file does not match the captured evidence record."
        ),
      },
      400
    );
  }

  if (
    isString(record.mimeType) &&
    record.mimeType.length > 0 &&
    file.type.length > 0 &&
    record.mimeType !== file.type
  ) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody(
          "INVALID_FILE",
          "The uploaded file does not match the captured evidence record."
        ),
      },
      400
    );
  }

  try {
    assertPreservationConfigured();
  } catch (error) {
    if (error instanceof PreservationServiceError) {
      return jsonResponse({ ok: false, error: error.toError() }, 503);
    }
    throw error;
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: errorBody("INVALID_FILE", "The file could not be read."),
      },
      400
    );
  }

  if (bytes.byteLength !== file.size) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody(
          "INVALID_FILE",
          "The uploaded file could not be read completely."
        ),
      },
      400
    );
  }

  const sha256 = computeSha256(bytes);
  const key = resolveEvidenceObjectKey(incidentId, evidenceId);
  const preservedAt = new Date().toISOString();
  const bucket = process.env.FRAUDFIRST_EVIDENCE_BUCKET as string;

  let upload;
  try {
    upload = await preserveEvidenceToS3({
      bucket,
      key,
      bytes,
      contentType,
      sha256,
      preservedAt,
    });
  } catch (error) {
    if (error instanceof PreservationServiceError) {
      const status = error.code === "S3_UPLOAD_FAILED" ? 500 : 503;
      return jsonResponse({ ok: false, error: error.toError() }, status);
    }
    throw error;
  }

  return jsonResponse(
    {
      ok: true,
      evidenceId,
      storage: {
        status: "preserved",
        preservedAt,
        sha256,
        s3Key: upload.key,
        bucket,
        contentType,
        byteSize: bytes.byteLength,
      },
    },
    200
  );
}