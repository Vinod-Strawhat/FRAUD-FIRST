export const SUPPORTED_PRESERVATION_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

export type SupportedPreservationMimeType =
  (typeof SUPPORTED_PRESERVATION_MIME_TYPES)[number];

export const MAX_PRESERVATION_BYTES = 5 * 1024 * 1024;

export type PreservationErrorCode =
  | "AWS_NOT_CONFIGURED"
  | "BUCKET_NOT_CONFIGURED"
  | "INVALID_FILE"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "INCIDENT_NOT_FOUND"
  | "EVIDENCE_NOT_FOUND"
  | "EVIDENCE_INCIDENT_MISMATCH"
  | "S3_UPLOAD_FAILED"
  | "MISSING_FIELD"
  | "FILE_REQUIRED"
  | "INVALID_REQUEST";

export interface PreservationError {
  code: PreservationErrorCode;
  message: string;
}

export interface EvidencePreservationMeta {
  status: "preserved";
  preservedAt: string;
  sha256: string;
  s3Key: string;
  bucket: string;
  contentType: string;
  byteSize: number;
}

export interface PreserveEvidenceSuccessResponse {
  ok: true;
  evidenceId: string;
  storage: EvidencePreservationMeta;
}

export interface PreserveEvidenceErrorResponse {
  ok: false;
  error: PreservationError;
}

export type PreserveEvidenceResponse =
  | PreserveEvidenceSuccessResponse
  | PreserveEvidenceErrorResponse;