import { createHash } from "node:crypto";

import {
  configuredEvidenceBucket,
  hasAwsCredentials,
  uploadEvidenceBytes,
  type EvidenceS3UploadResult,
} from "@/services/server/s3";
import {
  SUPPORTED_PRESERVATION_MIME_TYPES,
} from "@/types";
import type { PreservationError, PreservationErrorCode } from "@/types";

export const S3_OBJECT_KEY_RE =
  /^incidents\/FF-\d{8}-[A-Z2-9]{4}\/evidence\/ev_[A-Za-z0-9_-]+\/original$/;

const EXTENSION_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

function fileExtension(filename: string): string | null {
  const index = filename.lastIndexOf(".");
  if (index < 0) return null;
  return filename.slice(index).toLowerCase();
}

export function resolveEvidenceContentType(
  filename: string,
  mimeType: string
): string | null {
  if (
    (SUPPORTED_PRESERVATION_MIME_TYPES as readonly string[]).includes(mimeType)
  ) {
    return mimeType;
  }
  const extension = fileExtension(filename);
  if (extension && EXTENSION_MIME_TYPES[extension]) {
    return EXTENSION_MIME_TYPES[extension];
  }
  return null;
}

export class PreservationServiceError extends Error {
  readonly code: PreservationErrorCode;

  constructor(code: PreservationErrorCode, message: string) {
    super(message);
    this.name = "PreservationServiceError";
    this.code = code;
  }

  toError(): PreservationError {
    return { code: this.code, message: this.message };
  }
}

export function resolveEvidenceObjectKey(
  incidentId: string,
  evidenceId: string
): string {
  return `incidents/${incidentId}/evidence/${evidenceId}/original`;
}

export function computeSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function evidenceBucketOrThrow(): string {
  const bucket = configuredEvidenceBucket();
  if (!bucket) {
    throw new PreservationServiceError(
      "BUCKET_NOT_CONFIGURED",
      "The evidence bucket is not configured for this environment."
    );
  }
  return bucket;
}

export function assertPreservationConfigured(): void {
  if (!hasAwsCredentials()) {
    throw new PreservationServiceError(
      "AWS_NOT_CONFIGURED",
      "AWS storage is not configured for this environment."
    );
  }
  evidenceBucketOrThrow();
}

export interface PreserveEvidenceToS3Input {
  bucket: string;
  key: string;
  bytes: Uint8Array;
  contentType: string;
  sha256: string;
  preservedAt: string;
}

export async function preserveEvidenceToS3(
  input: PreserveEvidenceToS3Input
): Promise<EvidenceS3UploadResult> {
  try {
    return await uploadEvidenceBytes({
      bucket: input.bucket,
      key: input.key,
      body: input.bytes,
      contentType: input.contentType,
      sha256: input.sha256,
      preservedAt: input.preservedAt,
    });
  } catch (error) {
    const name =
      typeof error === "object" && error !== null && "name" in error
        ? (error as { name?: string }).name
        : undefined;
    if (name === "NoSuchBucket" || name === "NotFound") {
      throw new PreservationServiceError(
        "BUCKET_NOT_CONFIGURED",
        "The configured evidence bucket does not exist or is not accessible."
      );
    }
    throw new PreservationServiceError(
      "S3_UPLOAD_FAILED",
      "The original evidence could not be preserved. Please try again."
    );
  }
}