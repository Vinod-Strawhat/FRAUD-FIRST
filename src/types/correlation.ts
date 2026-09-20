export type CorrelationStatus =
  | "not_correlated"
  | "correlating"
  | "correlated"
  | "correlation_failed";

export type TimelineCandidateLabel =
  | "CONFIRMED FROM EVIDENCE"
  | "CANDIDATE / UNCERTAIN";

export type CorrelationErrorCode =
  | "MISSING_FIELD"
  | "INCIDENT_NOT_FOUND"
  | "EVIDENCE_NOT_FOUND"
  | "EVIDENCE_INCIDENT_MISMATCH"
  | "EXTRACTION_NOT_AVAILABLE"
  | "BEDROCK_NOT_CONFIGURED"
  | "BEDROCK_REQUEST_FAILED"
  | "BEDROCK_INVALID_OUTPUT"
  | "OPENROUTER_NOT_CONFIGURED"
  | "OPENROUTER_REQUEST_FAILED"
  | "OPENROUTER_INVALID_OUTPUT"
  | "INVALID_REQUEST";

export type CorrelationProviderName = "bedrock" | "openrouter" | "local";
export type CorrelationProviderMode = "primary" | "fallback";

export interface CorrelationError {
  code: CorrelationErrorCode;
  message: string;
}

export interface EvidenceDerivedFact {
  type: string;
  value: string;
  unit?: string;
  confidence: number;
  sourceEvidenceIds: string[];
  sourceText: string;
}

export interface TimelineCandidate {
  timestamp: string | null;
  event: string;
  sourceEvidenceIds: string[];
  confidence: number;
  label: TimelineCandidateLabel;
}

export interface IdentifierReference {
  type: string;
  value: string;
  sourceEvidenceIds: string[];
}

export interface ContactPoint {
  type: string;
  value: string;
  sourceEvidenceIds: string[];
}

export interface EvidenceUrl {
  value: string;
  sourceEvidenceIds: string[];
}

export interface MissingInformation {
  field: string;
  reason: string;
}

export interface UncertainInformation {
  field: string;
  reason: string;
  sourceEvidenceIds: string[];
}

export interface CorrelationAnalysis {
  facts: EvidenceDerivedFact[];
  timelineCandidates: TimelineCandidate[];
  identifiers: IdentifierReference[];
  contactPoints: ContactPoint[];
  urls: EvidenceUrl[];
  missingInformation: MissingInformation[];
  uncertainInformation: UncertainInformation[];
}

export interface EvidenceCorrelationMeta {
  status: CorrelationStatus;
  modelId?: string;
  correlatedAt?: string;
  durationMs?: number;
  textLength?: number;
  error?: CorrelationError;
  analysis?: CorrelationAnalysis;
  provider?: CorrelationProviderName;
  providerMode?: CorrelationProviderMode;
}

export interface CorrelatedCorrelationMeta {
  status: "correlated";
  modelId: string;
  correlatedAt: string;
  durationMs: number;
  textLength: number;
  analysis: CorrelationAnalysis;
  provider?: CorrelationProviderName;
  providerMode?: CorrelationProviderMode;
}

export interface CorrelateEvidenceSuccessResponse {
  ok: true;
  evidenceId: string;
  correlation: CorrelatedCorrelationMeta;
}

export interface CorrelateEvidenceErrorResponse {
  ok: false;
  error: CorrelationError;
}

export type CorrelateEvidenceResponse =
  | CorrelateEvidenceSuccessResponse
  | CorrelateEvidenceErrorResponse;

export interface EvidenceCorrelationClaim {
  id?: unknown;
  incidentId?: unknown;
  filename?: unknown;
  mimeType?: unknown;
  size?: unknown;
  category?: unknown;
  capturedAt?: unknown;
  extraction?: {
    source?: unknown;
    extractedAt?: unknown;
    confidence?: unknown;
    textLength?: unknown;
    text?: unknown;
  };
}

export interface CorrelateEvidenceRequest {
  incidentId?: unknown;
  evidenceId?: unknown;
  evidence?: EvidenceCorrelationClaim;
}

export type IncidentCorrelationStatus =
  | "not_ready"
  | "correlating"
  | "correlated"
  | "correlation_failed";

export type EvidenceCorrelationReadinessState =
  | "ready"
  | "processing"
  | "extraction_failed"
  | "no_text_found"
  | "not_extracted"
  | "preserved_extraction_unavailable"
  | "text_unavailable"
  | "unsupported_media";

export interface CorrelationNotReadyEvidence {
  evidenceId: string;
  filename?: string;
  state: EvidenceCorrelationReadinessState;
  reason: string;
}

export interface IncidentCorrelationMeta {
  status: IncidentCorrelationStatus;
  signature: string;
  evidenceCount: number;
  readyCount: number;
  sourceEvidenceIds: string[];
  notReadyEvidence: CorrelationNotReadyEvidence[];
  startedAt?: string;
  correlatedAt?: string;
  modelId?: string;
  durationMs?: number;
  textLength?: number;
  error?: CorrelationError;
  analysis?: CorrelationAnalysis;
  provider?: CorrelationProviderName;
  providerMode?: CorrelationProviderMode;
}

export interface CorrelationTextClaim {
  evidenceId: string;
  text: string;
  source?: string;
  confidence?: number;
  extractedAt?: string;
}

export interface CorrelateIncidentRequest {
  incidentId?: unknown;
  claims?: unknown;
}

export interface CorrelateIncidentSuccessResponse {
  ok: true;
  incidentId: string;
  correlation: IncidentCorrelationMeta;
}

export interface CorrelateIncidentErrorResponse {
  ok: false;
  error: CorrelationError;
}

export type CorrelateIncidentResponse =
  | CorrelateIncidentSuccessResponse
  | CorrelateIncidentErrorResponse;
