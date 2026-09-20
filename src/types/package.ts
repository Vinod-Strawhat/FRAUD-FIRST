import type {
  EvidenceCategory,
  EvidenceStatus,
  EvidenceStorageStatus,
} from "@/types/evidence";
import type {
  IncidentStatus,
  IncidentType,
} from "@/types/incident";
import type {
  IncidentIntelligenceBrief,
  IncidentIntelligenceStatus,
  IntelligenceNotReadyReason,
} from "@/types/intelligence";
import type {
  ResponseActionStatus,
  ResponseActionType,
  ResponseExecutionState,
  ResponseWorkflowStatus,
} from "@/types/response";
import type { IncidentTimelineEvent } from "@/types/timeline";

export const INCIDENT_PACKAGE_VERSION = 1 as const;

export const INCIDENT_PACKAGE_DISCLAIMER =
  "This file is an automated evidence package produced by FraudFirst for reference. It is not a police report, a legal document, a guarantee of recovery or admissibility, or a determination that fraud occurred. Evidence is listed from whatever is preserved at generation time; missing or imperfect records are described honestly. Keep the original messages, receipts, screenshots and any complaint references from official channels alongside this file.";

/** A read-only projection of one preserved or pending piece of evidence. */
export interface IncidentPackageEvidenceEntry {
  evidenceId: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  category: EvidenceCategory;
  categoryLabel: string;
  capturedAt: string;
  preserved: boolean;
  storageStatus: EvidenceStorageStatus;
  preservedAt?: string;
  sha256?: string;
  /** Stable reference to the preserved original, taken from persisted metadata only. */
  storageReference?: string;
  extractionStatus: EvidenceStatus;
}

export interface IncidentPackageResponseAction {
  type: ResponseActionType;
  title: string;
  status: ResponseActionStatus;
  order: number;
  createdAt: string;
  completedAt?: string;
}

export interface IncidentPackageResponse {
  started: boolean;
  status: ResponseWorkflowStatus;
  startedAt?: string;
  updatedAt?: string;
  currentActionType?: ResponseActionType | null;
  /** True only when the persisted response meta records a live Step Functions execution. */
  liveExecution: boolean;
  /** Reconciled execution state from persisted meta; present only when a live execution is recorded. */
  executionStatus?: ResponseExecutionState;
  actions: IncidentPackageResponseAction[];
}

export interface IncidentPackageIntelligence {
  available: boolean;
  status: IncidentIntelligenceStatus;
  reason?: IntelligenceNotReadyReason;
  message?: string;
  brief?: IncidentIntelligenceBrief | null;
}

export interface IncidentPackageIntegrity {
  preservedCount: number;
  unpreservedCount: number;
  hashesIncluded: boolean;
  preservedOriginalsReferenced: boolean;
  objectLock: boolean;
}

export interface IncidentPackageMeta {
  version: typeof INCIDENT_PACKAGE_VERSION;
  /** Deterministic: set to the persisted incident `updatedAt` (as-of snapshot). */
  generatedAt: string;
  incident: {
    incidentId: string;
    type: IncidentType;
    typeLabel: string;
    status: IncidentStatus;
    statusLabel: string;
    startedAt: string;
    updatedAt: string;
    amount: string | null;
  };
  intelligence: IncidentPackageIntelligence;
  response: IncidentPackageResponse;
  evidenceIndex: IncidentPackageEvidenceEntry[];
  timeline: IncidentTimelineEvent[];
  integrity: IncidentPackageIntegrity;
  disclaimer: string;
}

export type IncidentPackageNotReadyReason = "no_evidence" | "not_preserved";

export interface IncidentPackageNotReady {
  status: "not_ready";
  incidentId: string;
  reason: IncidentPackageNotReadyReason;
  message: string;
}

export interface IncidentPackageReady {
  status: "ready";
  incidentId: string;
  package: IncidentPackageMeta;
}

export type IncidentPackageResult = IncidentPackageNotReady | IncidentPackageReady;

export type PackageErrorCode =
  | "INCIDENT_NOT_FOUND"
  | "DYNAMODB_NOT_CONFIGURED"
  | "DYNAMODB_REQUEST_FAILED"
  | "INVALID_INCIDENT"
  | "INVALID_REQUEST";

export interface PackageError {
  code: PackageErrorCode;
  message: string;
}

export interface GetIncidentPackageSuccessResponse {
  ok: true;
  result: IncidentPackageResult;
}

export interface GetIncidentPackageErrorResponse {
  ok: false;
  error: PackageError;
}

export type GetIncidentPackageResponse =
  | GetIncidentPackageSuccessResponse
  | GetIncidentPackageErrorResponse;

export interface DownloadIncidentPackageSuccessResponse {
  ok: true;
  incidentId: string;
  filename: string;
  url: string;
}

export interface DownloadIncidentPackageNotReadyResponse {
  ok: false;
  code: "PACKAGE_NOT_READY";
  message: string;
}

export interface DownloadIncidentPackageErrorResponse {
  ok: false;
  error: PackageError;
}

export type DownloadIncidentPackageResponse =
  | DownloadIncidentPackageSuccessResponse
  | DownloadIncidentPackageNotReadyResponse
  | DownloadIncidentPackageErrorResponse;