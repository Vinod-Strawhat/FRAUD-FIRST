export type TimelineEventType =
  | "incident_started"
  | "evidence_intake_ready"
  | "evidence_captured"
  | "evidence_removed"
  | "evidence_processing_started"
  | "text_extracted"
  | "evidence_processing_failed"
  | "evidence_preservation_started"
  | "evidence_preserved"
  | "evidence_preservation_failed"
  | "evidence_correlated"
  | "evidence_correlation_failed"
  | "correlation_started"
  | "correlation_completed"
  | "correlation_failed"
  | "response_started"
  | "response_action_completed"
  | "response_completed"
  | "response_failed";

export type TimelineTone = "critical" | "warn" | "info" | "neutral";

export interface IncidentTimelineEvent {
  id: string;
  incidentId: string;
  type: TimelineEventType;
  tone: TimelineTone;
  label: string;
  detail?: string;
  occurredAt: string;
}

export interface AddTimelineEventInput {
  incidentId: string;
  type: TimelineEventType;
  tone: TimelineTone;
  label: string;
  detail?: string;
  occurredAt?: string;
}