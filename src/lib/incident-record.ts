import type {
  Incident,
  IncidentStatus,
  IncidentType,
  IncidentWorkspaceRecord,
  IncidentWorkspaceSnapshot,
  PersistentNextAction,
} from "@/types";
import { PERSISTENCE_SCHEMA_VERSION } from "@/types";

export { PERSISTENCE_SCHEMA_VERSION };

export function maxIsoTimestamp(values: (string | undefined | null)[]): string {
  let latest = "";
  for (const value of values) {
    if (!value) continue;
    if (value > latest) latest = value;
  }
  return latest;
}

export function deriveNextAction(status: IncidentStatus): PersistentNextAction {
  switch (status) {
    case "response_in_progress":
      return {
        primary: "Contact 1930",
        secondary: ["Freeze or flag the account", "Preserve evidence"],
      };
    case "evidence_review":
      return {
        primary: "Review preserved evidence",
        secondary: ["Contact bank", "Report online"],
      };
    case "action_required":
      return {
        primary: "Contact 1930",
        secondary: ["Freeze or flag the account", "Report online"],
      };
    case "completed":
      return {
        primary: "Incident follow-up",
        secondary: ["Contact 1930", "Report online"],
      };
  }
}

export function workspaceUpdatedAt(snapshot: IncidentWorkspaceSnapshot): string {
  return maxIsoTimestamp([
    snapshot.incident?.updatedAt,
    ...snapshot.evidence.map((evidence) => evidence.capturedAt),
    ...snapshot.timeline.map((event) => event.occurredAt),
  ]);
}

export function buildIncidentWorkspaceRecord(
  snapshot: IncidentWorkspaceSnapshot
): IncidentWorkspaceRecord | null {
  const incident = snapshot.incident;
  if (!incident) return null;
  return {
    incidentId: incident.id,
    schemaVersion: PERSISTENCE_SCHEMA_VERSION,
    status: incident.status,
    type: incident.type,
    amount: incident.amount ?? null,
    createdAt: incident.createdAt,
    startedAt: incident.startedAt,
    updatedAt: workspaceUpdatedAt(snapshot),
    evidence: snapshot.evidence
      .filter((entry) => entry.incidentId === incident.id)
      .map((entry) => sanitizeEvidenceRecord(entry)),
    timeline: snapshot.timeline
      .filter((event) => event.incidentId === incident.id)
      .map((event) => ({
        id: event.id,
        incidentId: event.incidentId,
        type: event.type,
        tone: event.tone,
        label: event.label,
        detail: event.detail,
        occurredAt: event.occurredAt,
      })),
    nextAction: deriveNextAction(incident.status),
  };
}

function sanitizeEvidenceRecord(
  record: IncidentWorkspaceSnapshot["evidence"][number]
): IncidentWorkspaceSnapshot["evidence"][number] {
  return {
    id: record.id,
    incidentId: record.incidentId,
    filename: record.filename,
    mimeType: record.mimeType,
    size: record.size,
    category: record.category,
    status: record.status,
    capturedAt: record.capturedAt,
    ...(record.extraction
      ? {
          extraction: {
            source: record.extraction.source,
            extractedAt: record.extraction.extractedAt,
            confidence: record.extraction.confidence,
            textLength: record.extraction.textLength,
          },
        }
      : {}),
    ...(record.storage ? { storage: record.storage } : {}),
    ...(record.correlation ? { correlation: record.correlation } : {}),
  };
}

export function incidentFromRecord(
  record: IncidentWorkspaceRecord
): Incident {
  return {
    id: record.incidentId,
    status: record.status,
    type: record.type as IncidentType,
    amount: record.amount,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
  };
}

function sortableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortableValue);
  }
  if (typeof value === "object" && value !== null) {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      output[key] = sortableValue((value as Record<string, unknown>)[key]);
    }
    return output;
  }
  return value;
}

export function workspaceRecordSignature(record: IncidentWorkspaceRecord): string {
  return JSON.stringify(sortableValue(record));
}