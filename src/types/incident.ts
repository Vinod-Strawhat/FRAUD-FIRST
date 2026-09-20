export type IncidentStatus =
  | "response_in_progress"
  | "evidence_review"
  | "action_required"
  | "completed";

export type IncidentType =
  | "unclassified"
  | "upi_fraud"
  | "bank_fraud"
  | "online_shopping_fraud"
  | "investment_scam"
  | "job_scam"
  | "identity_theft"
  | "other";

export interface Incident {
  id: string;
  status: IncidentStatus;
  type: IncidentType;
  createdAt: string;
  startedAt: string;
  updatedAt: string;
  amount: string | null;
}

export interface CreateIncidentInput {
  type?: IncidentType;
  amount?: string | null;
}

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  response_in_progress: "Response in progress",
  evidence_review: "Evidence review",
  action_required: "Action required",
  completed: "Completed",
};

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  unclassified: "Unclassified",
  upi_fraud: "UPI fraud",
  bank_fraud: "Bank fraud",
  online_shopping_fraud: "Online shopping fraud",
  investment_scam: "Investment scam",
  job_scam: "Job scam",
  identity_theft: "Identity theft",
  other: "Other",
};