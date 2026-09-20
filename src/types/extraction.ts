export const TEXT_EXTRACTION_SOURCE = "aws-textract" as const;

export type TextExtractionSource = "aws-textract" | "tesseract";

export interface ExtractedText {
  text: string;
  confidence?: number;
  source: TextExtractionSource;
  extractedAt: string;
}

export type ExtractionStatus = "processing" | "processed" | "failed";

export type ExtractionErrorCode =
  | "AWS_NOT_CONFIGURED"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "FILE_TOO_LARGE"
  | "MISSING_FIELD"
  | "FILE_REQUIRED"
  | "INCIDENT_NOT_FOUND"
  | "EVIDENCE_NOT_FOUND"
  | "FILE_NOT_READABLE"
  | "EXTRACTION_FAILED"
  | "INVALID_REQUEST";

export interface ExtractionError {
  code: ExtractionErrorCode;
  message: string;
}

export interface EvidenceExtractionResult {
  evidenceId: string;
  status: "processed";
  text: string;
  confidence?: number;
  source: TextExtractionSource;
  extractedAt: string;
  provider?: "textract" | "tesseract";
  providerMode?: "primary" | "fallback";
}

export interface ExtractEvidenceSuccessResponse {
  ok: true;
  evidenceId: string;
  status: "processed";
  extraction: EvidenceExtractionResult;
}

export interface ExtractEvidenceErrorResponse {
  ok: false;
  error: ExtractionError;
}

export type ExtractEvidenceResponse =
  | ExtractEvidenceSuccessResponse
  | ExtractEvidenceErrorResponse;

export interface EvidenceExtractionMeta {
  source: TextExtractionSource;
  extractedAt: string;
  confidence?: number;
  textLength: number;
  provider?: "textract" | "tesseract";
  providerMode?: "primary" | "fallback";
}
