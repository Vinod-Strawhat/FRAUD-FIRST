import type {
  ContactPoint,
  CorrelationErrorCode,
  EvidenceDerivedFact,
  EvidenceUrl,
  IdentifierReference,
  MissingInformation,
  TimelineCandidate,
  UncertainInformation,
} from "@/types/correlation";
import type { IncidentType } from "@/types/incident";
import type { PersistenceError } from "@/types/persistence";

export interface ExtractedFact {
  id: string;
  incidentId: string;
  category: string;
  value: string;
  confidence: number;
  createdAt: string;
}

export interface CorrelationResult {
  incidentId: string;
  matchedSignals: string[];
  createdAt: string;
}

export type IncidentIntelligenceStatus =
  | "not_ready"
  | "failed"
  | "ready";

export type IntelligenceNotReadyReason =
  | "no_evidence"
  | "not_preserved"
  | "extraction_unavailable"
  | "correlation_pending";

export const INTELLIGENCE_NO_EVIDENCE_MESSAGE =
  "No evidence captured yet.";
export const INTELLIGENCE_NOT_PRESERVED_MESSAGE =
  "Evidence must be preserved before intelligence can be generated.";
export const INTELLIGENCE_EXTRACTION_UNAVAILABLE_MESSAGE =
  "Evidence extraction unavailable.";
export const INTELLIGENCE_CORRELATION_PENDING_MESSAGE =
  "Correlation has not completed yet.";
export const INTELLIGENCE_CORRELATION_FAILED_MESSAGE =
  "Correlation failed. The previous successful correlation, if any, remains available.";

/**
 * A structured, traceable intelligence brief derived exclusively from the
 * last successful persisted correlation of this incident. The brief is a
 * read-only projection: every fact, timeline entry, identifier, contact
 * point, URL, missing and uncertain item is carried over from the persisted
 * `IncidentCorrelationMeta.analysis` with its `sourceEvidenceIds` intact.
 * Nothing is invented and no AI provider is contacted during generation.
 *
 * Facts are carried as `IncidentIntelligenceFact`, which intentionally omits
 * `sourceText`: the brief never echoes extracted text snippets.
 */
export interface IncidentIntelligenceFact
  extends Omit<EvidenceDerivedFact, "sourceText"> {
  sourceText?: undefined;
}

export interface IncidentIntelligenceBrief {
  incidentId: string;
  incidentType: IncidentType;
  incidentTypeLabel: string;
  /** Deterministic timestamp of the correlation run that produced this brief. */
  generatedAt: string;
  sourceCorrelationTimestamp: string;
  modelId?: string;
  summary: string;
  sourceEvidenceIds: string[];
  facts: IncidentIntelligenceFact[];
  financialReferences: IncidentIntelligenceFact[];
  timeline: TimelineCandidate[];
  identifiers: IdentifierReference[];
  contactPoints: ContactPoint[];
  urls: EvidenceUrl[];
  missingInformation: MissingInformation[];
  uncertainInformation: UncertainInformation[];
}

export interface IncidentIntelligenceNotReady {
  status: "not_ready";
  incidentId: string;
  reason: IntelligenceNotReadyReason;
  message: string;
}

export interface IncidentIntelligenceFailed {
  status: "failed";
  incidentId: string;
  errorCode: CorrelationErrorCode | string;
  message: string;
  previous?: IncidentIntelligenceBrief;
}

export interface IncidentIntelligenceReady {
  status: "ready";
  incidentId: string;
  brief: IncidentIntelligenceBrief;
}

export type IncidentIntelligence =
  | IncidentIntelligenceNotReady
  | IncidentIntelligenceFailed
  | IncidentIntelligenceReady;

export interface GetIncidentIntelligenceSuccessResponse {
  ok: true;
  intelligence: IncidentIntelligence;
}

export interface GetIncidentIntelligenceErrorResponse {
  ok: false;
  error: PersistenceError;
}

export type GetIncidentIntelligenceResponse =
  | GetIncidentIntelligenceSuccessResponse
  | GetIncidentIntelligenceErrorResponse;