import type { Incident, IncidentStatus, IncidentType } from "@/types/incident";
import type { EvidenceRecord } from "@/types/evidence";
import type { IncidentTimelineEvent } from "@/types/timeline";
import type { IncidentResponseMeta } from "@/types/response";
import type { IncidentCorrelationMeta } from "@/types/correlation";

export const PERSISTENCE_SCHEMA_VERSION = 1 as const;

export type PersistenceStatus =
  | "local"
  | "syncing"
  | "synced"
  | "unavailable";

export type PersistenceErrorCode =
  | "INCIDENT_NOT_FOUND"
  | "EVIDENCE_NOT_FOUND"
  | "EXTRACTION_NOT_AVAILABLE"
  | "DYNAMODB_NOT_CONFIGURED"
  | "DYNAMODB_REQUEST_FAILED"
  | "INVALID_INCIDENT"
  | "INVALID_REQUEST";

export interface PersistenceError {
  code: PersistenceErrorCode;
  message: string;
}

export interface PersistentNextAction {
  primary: string;
  secondary: string[];
}

export interface IncidentWorkspaceRecord {
  incidentId: string;
  schemaVersion: typeof PERSISTENCE_SCHEMA_VERSION;
  status: IncidentStatus;
  type: IncidentType;
  amount: string | null;
  createdAt: string;
  startedAt: string;
  updatedAt: string;
  evidence: EvidenceRecord[];
  timeline: IncidentTimelineEvent[];
  nextAction: PersistentNextAction;
  response?: IncidentResponseMeta;
  correlation?: IncidentCorrelationMeta;
}

export interface IncidentWorkspaceSnapshot {
  incident: Incident | null;
  evidence: EvidenceRecord[];
  timeline: IncidentTimelineEvent[];
}

export interface GetIncidentSuccessResponse {
  ok: true;
  incident: IncidentWorkspaceRecord;
}

export interface GetIncidentErrorResponse {
  ok: false;
  error: PersistenceError;
}

export type GetIncidentResponse = GetIncidentSuccessResponse | GetIncidentErrorResponse;

export interface PutIncidentSuccessResponse {
  ok: true;
  incidentId: string;
  updatedAt: string;
}

export interface PutIncidentErrorResponse {
  ok: false;
  error: PersistenceError;
}

export type PutIncidentResponse = PutIncidentSuccessResponse | PutIncidentErrorResponse;