import type { IncidentIntelligence } from "@/types/intelligence";
import type {
  IncidentPackageEvidenceEntry,
  IncidentPackageIntelligence,
  IncidentPackageMeta,
  IncidentPackageNotReadyReason,
  IncidentPackageResponse,
  IncidentPackageResult,
  IncidentWorkspaceRecord,
  PackageError,
  PackageErrorCode,
  ResponseExecutionState,
  ResponseWorkflowStatus,
} from "@/types";
import {
  EVIDENCE_CATEGORY_LABELS,
} from "@/types/evidence";
import {
  INCIDENT_STATUS_LABELS,
  INCIDENT_TYPE_LABELS,
} from "@/types/incident";
import {
  getIncident,
  isValidIncidentId,
  PersistenceServiceError,
} from "@/services/incident-persistence";
import {
  getIncidentIntelligence,
} from "@/services/intelligence/brief";
import { responseActionDefinition } from "@/services/response/sequence";
import {
  INCIDENT_PACKAGE_DISCLAIMER,
  INCIDENT_PACKAGE_VERSION,
} from "@/types/package";

export const PACKAGE_NOT_READY_NO_EVIDENCE_MESSAGE = "No evidence captured yet.";
export const PACKAGE_NOT_READY_NOT_PRESERVED_MESSAGE =
  "At least one piece of evidence must be preserved before a package can be generated.";

export class PackageServiceError extends Error {
  readonly code: PackageErrorCode;

  constructor(code: PackageErrorCode, message: string) {
    super(message);
    this.name = "PackageServiceError";
    this.code = code;
  }

  toError(): PackageError {
    return { code: this.code, message: this.message };
  }
}

function mapIncidentPersistenceError(error: unknown): never {
  if (error instanceof PackageServiceError) {
    throw error;
  }
  if (error instanceof PersistenceServiceError) {
    const code: PackageErrorCode =
      error.code === "INCIDENT_NOT_FOUND"
        ? "INCIDENT_NOT_FOUND"
        : error.code === "DYNAMODB_NOT_CONFIGURED"
          ? "DYNAMODB_NOT_CONFIGURED"
          : error.code === "INVALID_INCIDENT"
            ? "INVALID_INCIDENT"
            : "DYNAMODB_REQUEST_FAILED";
    throw new PackageServiceError(code, error.message);
  }
  throw new PackageServiceError(
    "DYNAMODB_REQUEST_FAILED",
    "The incident package could not be generated."
  );
}

function executionStateFromResponseStatus(
  status: Exclude<ResponseWorkflowStatus, "not_started">
): ResponseExecutionState {
  switch (status) {
    case "completed":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    default:
      return "RUNNING";
  }
}

function buildIntelligenceSection(
  intelligence: IncidentIntelligence
): IncidentPackageIntelligence {
  if (intelligence.status === "ready") {
    return {
      available: true,
      status: "ready",
      brief: intelligence.brief,
    };
  }
  if (intelligence.status === "not_ready") {
    return {
      available: false,
      status: "not_ready",
      reason: intelligence.reason,
      message: intelligence.message,
    };
  }
  return {
    available: false,
    status: "failed",
    message: intelligence.message,
  };
}

function buildResponseSection(
  meta: IncidentWorkspaceRecord["response"]
): IncidentPackageResponse {
  if (!meta) {
    return {
      started: false,
      status: "not_started",
      liveExecution: false,
      actions: [],
    };
  }
  const actions = [...meta.actions]
    .map((action) => ({
      type: action.type,
      title: responseActionDefinition(action.type).title,
      status: action.status,
      order: action.order,
      createdAt: action.createdAt,
      ...(action.completedAt ? { completedAt: action.completedAt } : {}),
    }))
    .sort((a, b) => a.order - b.order);
  return {
    started: true,
    status: meta.status,
    startedAt: meta.startedAt,
    updatedAt: meta.updatedAt,
    currentActionType: meta.currentActionType,
    liveExecution: Boolean(meta.executionArn),
    ...(meta.executionArn
      ? { executionStatus: executionStateFromResponseStatus(meta.status) }
      : {}),
    actions,
  };
}

function buildEvidenceEntry(
  incidentId: string,
  evidence: IncidentWorkspaceRecord["evidence"][number]
): IncidentPackageEvidenceEntry {
  const storage = evidence.storage;
  const preserved = storage?.status === "preserved";
  return {
    evidenceId: evidence.id,
    originalFilename: evidence.filename,
    mimeType: evidence.mimeType,
    size: evidence.size,
    category: evidence.category,
    categoryLabel: EVIDENCE_CATEGORY_LABELS[evidence.category],
    capturedAt: evidence.capturedAt,
    preserved,
    storageStatus: storage?.status ?? "not_preserved",
    ...(storage?.preservedAt ? { preservedAt: storage.preservedAt } : {}),
    ...(preserved && storage?.sha256 ? { sha256: storage.sha256 } : {}),
    ...(preserved && storage?.s3Key
      ? { storageReference: storage.s3Key }
      : {}),
    extractionStatus: evidence.status,
  };
}

/**
 * A deterministic, read-only projection of a preserved incident into a
 * structured evidence package. Never generates hashes, never contacts S3,
 * Step Functions, Textract or Bedrock, and never invents data: every field is
 * derived from the persisted workspace record and the persisted intelligence.
 */
export function composeIncidentPackage(
  record: IncidentWorkspaceRecord,
  intelligence: IncidentIntelligence
): IncidentPackageMeta {
  const evidenceIndex = record.evidence.map((item) =>
    buildEvidenceEntry(record.incidentId, item)
  );
  const preservedEntries = evidenceIndex.filter((entry) => entry.preserved);
  const preservedCount = preservedEntries.length;

  return {
    version: INCIDENT_PACKAGE_VERSION,
    generatedAt: record.updatedAt,
    incident: {
      incidentId: record.incidentId,
      type: record.type,
      typeLabel: INCIDENT_TYPE_LABELS[record.type],
      status: record.status,
      statusLabel: INCIDENT_STATUS_LABELS[record.status],
      startedAt: record.startedAt,
      updatedAt: record.updatedAt,
      amount: record.amount,
    },
    intelligence: buildIntelligenceSection(intelligence),
    response: buildResponseSection(record.response),
    evidenceIndex,
    timeline: record.timeline,
    integrity: {
      preservedCount,
      unpreservedCount: record.evidence.length - preservedCount,
      hashesIncluded: preservedEntries.some((entry) => Boolean(entry.sha256)),
      preservedOriginalsReferenced: preservedEntries.some((entry) =>
        Boolean(entry.storageReference)
      ),
      objectLock: false,
    },
    disclaimer: INCIDENT_PACKAGE_DISCLAIMER,
  };
}

export function incidentPackageNotReadyReason(
  record: IncidentWorkspaceRecord
): IncidentPackageNotReadyReason | null {
  if (record.evidence.length === 0) {
    return "no_evidence";
  }
  const preserved = record.evidence.some(
    (item) => item.storage?.status === "preserved"
  );
  return preserved ? null : "not_preserved";
}

/**
 * Builds the evidence package for an incident. Read-only: fails hard when the
 * incident does not exist or when the environment cannot be reached, and
 * returns an explicit `not_ready` result (never a fabricated package) when the
 * incident has no evidence or nothing preserved.
 */
export async function buildIncidentPackage(
  incidentId: string
): Promise<IncidentPackageResult> {
  if (!isValidIncidentId(incidentId)) {
    throw new PackageServiceError("INVALID_INCIDENT", "The incident id is not valid.");
  }

  let record: IncidentWorkspaceRecord;
  try {
    const incident = await getIncident(incidentId);
    if (!incident) {
      throw new PackageServiceError(
        "INCIDENT_NOT_FOUND",
        "No incident exists with this id."
      );
    }
    record = incident;
  } catch (error) {
    mapIncidentPersistenceError(error);
  }

  const reason = incidentPackageNotReadyReason(record);
  if (reason === "no_evidence") {
    return {
      status: "not_ready",
      incidentId,
      reason,
      message: PACKAGE_NOT_READY_NO_EVIDENCE_MESSAGE,
    };
  }
  if (reason === "not_preserved") {
    return {
      status: "not_ready",
      incidentId,
      reason,
      message: PACKAGE_NOT_READY_NOT_PRESERVED_MESSAGE,
    };
  }

  const intelligence = await getIncidentIntelligence(incidentId);
  return {
    status: "ready",
    incidentId,
    package: composeIncidentPackage(record, intelligence),
  };
}

