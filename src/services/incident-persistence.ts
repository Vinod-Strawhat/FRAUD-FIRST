import type {
  CorrelationAnalysis,
  CorrelationErrorCode,
  CorrelationNotReadyEvidence,
  EvidenceCategory,
  EvidenceCorrelationMeta,
  EvidenceCorrelationReadinessState,
  EvidenceRecord,
  EvidenceStatus,
  EvidenceStorageMeta,
  EvidenceStorageStatus,
  IncidentCorrelationMeta,
  IncidentCorrelationStatus,
  IncidentResponseMeta,
  IncidentStatus,
  IncidentType,
  IncidentWorkspaceRecord,
  PersistenceError,
  PersistenceErrorCode,
  PersistentNextAction,
  PersistentResponseAction,
  ResponseActionStatus,
  ResponseActionType,
  TimelineEventType,
  TimelineTone,
  TextExtractionSource,
} from "@/types";
import { INCIDENT_STATUS_LABELS, INCIDENT_TYPE_LABELS } from "@/types";
import {
  deleteIncidentRecord,
  hasPersistenceConfiguration,
  readIncidentRecord,
  writeIncidentRecord,
  DynamoDbConflictError,
  DynamoDbServiceError,
} from "@/services/server/dynamodb";

export const PERSISTENCE_SCHEMA_VERSION = 1 as const;

const INCIDENT_ID_RE = /^FF-\d{8}-[A-Z2-9]{4}$/;
const ENTITY_ID_RE = /^(ev|tl)_[A-Za-z0-9_-]+$/;

const INCIDENT_STATUSES: readonly string[] = Object.keys(
  INCIDENT_STATUS_LABELS
) as IncidentStatus[];
const INCIDENT_TYPES: readonly string[] = Object.keys(
  INCIDENT_TYPE_LABELS
) as IncidentType[];

const EVIDENCE_STATUSES: readonly EvidenceStatus[] = [
  "captured",
  "processing",
  "processed",
  "failed",
];
const EVIDENCE_CATEGORIES: readonly EvidenceCategory[] = [
  "bank_sms",
  "upi_screenshot",
  "whatsapp_chat",
  "phone_number",
  "qr_code",
  "email",
  "transaction_receipt",
  "other",
  "unclassified",
];
const EVIDENCE_STORAGE_STATUSES: readonly EvidenceStorageStatus[] = [
  "not_preserved",
  "preserving",
  "preserved",
  "preservation_failed",
];
const TIMELINE_TYPES: readonly TimelineEventType[] = [
  "incident_started",
  "evidence_intake_ready",
  "evidence_captured",
  "evidence_removed",
  "evidence_processing_started",
  "text_extracted",
  "evidence_processing_failed",
  "evidence_preservation_started",
  "evidence_preserved",
  "evidence_preservation_failed",
  "evidence_correlated",
  "evidence_correlation_failed",
  "correlation_started",
  "correlation_completed",
  "correlation_failed",
  "response_started",
  "response_action_completed",
  "response_completed",
  "response_failed",
];
const TIMELINE_TONES: readonly TimelineTone[] = [
  "critical",
  "warn",
  "info",
  "neutral",
];

export const MAX_EVIDENCE_RECORDS = 500;
export const MAX_TIMELINE_EVENTS = 2000;
export const MAX_STRING_CHARS = 1024;

export class PersistenceServiceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string) {
    super(message);
    this.name = "PersistenceServiceError";
    this.code = code;
  }

  toError(): PersistenceError {
    return { code: this.code, message: this.message };
  }
}

export function isValidIncidentId(value: unknown): value is string {
  return typeof value === "string" && INCIDENT_ID_RE.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function nonEmptyString(
  value: unknown,
  field: string,
  max: number = MAX_STRING_CHARS
): string {
  if (!isString(value) || value.trim().length === 0) {
    throw new PersistenceServiceError("INVALID_REQUEST", `${field} is invalid.`);
  }
  if (value.length > max) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      `${field} exceeds the supported length.`
    );
  }
  return value;
}

function optionalString(
  value: unknown,
  field: string,
  max: number = MAX_STRING_CHARS
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isString(value)) {
    throw new PersistenceServiceError("INVALID_REQUEST", `${field} is invalid.`);
  }
  if (value.length > max) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      `${field} exceeds the supported length.`
    );
  }
  return value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function deriveNextAction(status: IncidentStatus): PersistentNextAction {
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

function canonicalizeNextAction(value: unknown): PersistentNextAction {
  if (!isRecord(value)) {
    return deriveNextAction("response_in_progress");
  }
  const primary = optionalString(value.primary, "nextAction.primary", 256);
  const rawSecondary = Array.isArray(value.secondary) ? value.secondary : [];
  const secondary: string[] = [];
  for (const item of rawSecondary.slice(0, 16)) {
    if (isString(item) && item.trim().length > 0) {
      secondary.push(item.slice(0, 256));
    }
  }
  return {
    primary: primary && primary.length > 0 ? primary : "Contact 1930",
    secondary,
  };
}

const CORRELATION_STATUSES: readonly string[] = [
  "not_correlated",
  "correlating",
  "correlated",
  "correlation_failed",
];
const CORRELATION_ERROR_CODES: readonly string[] = [
  "MISSING_FIELD",
  "INCIDENT_NOT_FOUND",
  "EVIDENCE_NOT_FOUND",
  "EVIDENCE_INCIDENT_MISMATCH",
  "EXTRACTION_NOT_AVAILABLE",
  "BEDROCK_NOT_CONFIGURED",
  "BEDROCK_REQUEST_FAILED",
  "BEDROCK_INVALID_OUTPUT",
  "INVALID_REQUEST",
];

function canonicalizeCorrelationAnalysis(
  value: unknown
): CorrelationAnalysis | undefined {
  if (!isRecord(value)) return undefined;
  const analysis = value as unknown as CorrelationAnalysis;
  if (
    !Array.isArray(analysis.facts) ||
    !Array.isArray(analysis.timelineCandidates) ||
    !Array.isArray(analysis.identifiers) ||
    !Array.isArray(analysis.contactPoints) ||
    !Array.isArray(analysis.urls) ||
    !Array.isArray(analysis.missingInformation) ||
    !Array.isArray(analysis.uncertainInformation)
  ) {
    return undefined;
  }
  return analysis;
}

function canonicalizeEvidence(
  value: unknown,
  incidentId: string
): EvidenceRecord {
  if (!isRecord(value)) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "evidence contains an invalid record."
    );
  }
  const id = isString(value.id) && ENTITY_ID_RE.test(value.id) ? value.id : undefined;
  if (!id || id.startsWith("ev_") === false || value.incidentId !== incidentId) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "evidence contains a record that does not belong to this incident."
    );
  }
  const filename = nonEmptyString(value.filename, "evidence.filename", 512);
  const mimeType = nonEmptyString(value.mimeType, "evidence.mimeType", 256);
  if (!isFiniteNumber(value.size) || value.size < 0) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "evidence.size is invalid."
    );
  }
  const category = isString(value.category)
    ? value.category
    : "unclassified";
  if (!(EVIDENCE_CATEGORIES as readonly string[]).includes(category)) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "evidence.category is invalid."
    );
  }
  const status = isString(value.status) ? value.status : "captured";
  if (!(EVIDENCE_STATUSES as readonly string[]).includes(status)) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "evidence.status is invalid."
    );
  }
  const capturedAt = nonEmptyString(value.capturedAt, "evidence.capturedAt");

  const record: EvidenceRecord = {
    id,
    incidentId,
    filename,
    mimeType,
    size: value.size,
    category: category as EvidenceCategory,
    status: status as EvidenceStatus,
    capturedAt,
  };

  if (isRecord(value.extraction)) {
    const extractionSource = isString(value.extraction.source)
      ? value.extraction.source
      : undefined;
    if (extractionSource !== "aws-textract") {
      throw new PersistenceServiceError(
        "INVALID_REQUEST",
        "extraction.source is invalid."
      );
    }
    const textLength = isFiniteNumber(value.extraction.textLength)
      ? value.extraction.textLength
      : undefined;
    if (textLength === undefined) {
      throw new PersistenceServiceError(
        "INVALID_REQUEST",
        "extraction.textLength is required."
      );
    }
    const extraction: {
      source: TextExtractionSource;
      extractedAt: string;
      confidence?: number;
      textLength: number;
    } = {
      source: "aws-textract",
      extractedAt: nonEmptyString(
        value.extraction.extractedAt,
        "extraction.extractedAt"
      ),
      textLength,
    };
    if (isFiniteNumber(value.extraction.confidence)) {
      extraction.confidence = value.extraction.confidence;
    }
    record.extraction = extraction;
  }

  if (isRecord(value.storage)) {
    const storageStatus = isString(value.storage.status)
      ? value.storage.status
      : "not_preserved";
    if (!(EVIDENCE_STORAGE_STATUSES as readonly string[]).includes(storageStatus)) {
      throw new PersistenceServiceError(
        "INVALID_REQUEST",
        "evidence.storage.status is invalid."
      );
    }
    const storage: EvidenceStorageMeta = {
      status: storageStatus as EvidenceStorageStatus,
      preservedAt: optionalString(value.storage.preservedAt, "storage.preservedAt"),
      sha256: optionalString(value.storage.sha256, "storage.sha256", 128),
      s3Key: optionalString(value.storage.s3Key, "storage.s3Key", 512),
      bucket: optionalString(value.storage.bucket, "storage.bucket", 256),
      contentType: optionalString(value.storage.contentType, "storage.contentType", 256),
      byteSize: isFiniteNumber(value.storage.byteSize)
        ? value.storage.byteSize
        : undefined,
    };
    record.storage = storage;
  }

  if (isRecord(value.correlation)) {
    const correlation: EvidenceCorrelationMeta = { status: "not_correlated" };
    const correlationStatus = isString(value.correlation.status)
      ? value.correlation.status
      : "not_correlated";
    if (!CORRELATION_STATUSES.includes(correlationStatus)) {
      throw new PersistenceServiceError(
        "INVALID_REQUEST",
        "evidence.correlation.status is invalid."
      );
    }
    correlation.status = correlationStatus as EvidenceCorrelationMeta["status"];
    correlation.modelId = optionalString(
      value.correlation.modelId,
      "correlation.modelId",
      256
    );
    correlation.correlatedAt = optionalString(
      value.correlation.correlatedAt,
      "correlation.correlatedAt"
    );
    correlation.durationMs = isFiniteNumber(value.correlation.durationMs)
      ? value.correlation.durationMs
      : undefined;
    correlation.textLength = isFiniteNumber(value.correlation.textLength)
      ? value.correlation.textLength
      : undefined;
    if (isRecord(value.correlation.error)) {
      const errorCode = optionalString(
        value.correlation.error.code,
        "error.code",
        128
      );
      if (
        !errorCode ||
        !CORRELATION_ERROR_CODES.includes(errorCode)
      ) {
        throw new PersistenceServiceError(
          "INVALID_REQUEST",
          "evidence.correlation.error is invalid."
        );
      }
      correlation.error = {
        code: errorCode as CorrelationErrorCode,
        message:
          optionalString(value.correlation.error.message, "error.message", 512) ??
          "",
      };
    }
    correlation.analysis = canonicalizeCorrelationAnalysis(
      value.correlation.analysis
    );
    record.correlation = correlation;
  }

  return record;
}

const RESPONSE_ACTION_TYPES: readonly ResponseActionType[] = [
  "preserve_evidence",
  "contact_bank",
  "contact_1930",
  "report_cybercrime",
  "follow_up",
];
const RESPONSE_STATUSES: readonly string[] = ["running", "completed", "failed"];
const RESPONSE_ACTION_STATUSES: readonly string[] = [
  "pending",
  "in_progress",
  "completed",
  "skipped",
];

function canonicalizeResponse(value: unknown): IncidentResponseMeta {
  if (!isRecord(value)) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "response is invalid."
    );
  }
  const status = isString(value.status) ? value.status : undefined;
  if (!status || !RESPONSE_STATUSES.includes(status)) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "response.status is invalid."
    );
  }
  const startedAt = nonEmptyString(value.startedAt, "response.startedAt");
  const updatedAt = nonEmptyString(value.updatedAt, "response.updatedAt");

  const executionArn = optionalString(
    value.executionArn,
    "response.executionArn",
    512
  );

  const currentRaw = value.currentActionType;
  const currentActionType =
    currentRaw === null || currentRaw === undefined
      ? null
      : isString(currentRaw) && RESPONSE_ACTION_TYPES.includes(currentRaw as ResponseActionType)
        ? (currentRaw as ResponseActionType)
        : undefined;
  if (currentActionType === undefined) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "response.currentActionType is invalid."
    );
  }

  const actionsInput = Array.isArray(value.actions) ? value.actions : [];
  if (actionsInput.length > RESPONSE_ACTION_TYPES.length) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "Too many response actions."
    );
  }
  const actions: PersistentResponseAction[] = [];
  const seenTypes = new Set<string>();
  for (const entry of actionsInput) {
    if (!isRecord(entry)) {
      throw new PersistenceServiceError(
        "INVALID_REQUEST",
        "response contains an invalid action."
      );
    }
    const type = isString(entry.type) ? entry.type : undefined;
    if (!type || !RESPONSE_ACTION_TYPES.includes(type as ResponseActionType)) {
      throw new PersistenceServiceError(
        "INVALID_REQUEST",
        "response action type is invalid."
      );
    }
    if (seenTypes.has(type)) {
      throw new PersistenceServiceError(
        "INVALID_REQUEST",
        "response action type is duplicated."
      );
    }
    seenTypes.add(type);
    const actionStatus = isString(entry.status) ? entry.status : undefined;
    if (!actionStatus || !RESPONSE_ACTION_STATUSES.includes(actionStatus)) {
      throw new PersistenceServiceError(
        "INVALID_REQUEST",
        "response action status is invalid."
      );
    }
    const order = isFiniteNumber(entry.order) ? entry.order : undefined;
    if (order === undefined || order < 1 || order > RESPONSE_ACTION_TYPES.length) {
      throw new PersistenceServiceError(
        "INVALID_REQUEST",
        "response action order is invalid."
      );
    }
    const id = isString(entry.id) ? entry.id : undefined;
    if (!id || id.startsWith("resp_") === false) {
      throw new PersistenceServiceError(
        "INVALID_REQUEST",
        "response action id is invalid."
      );
    }
    actions.push({
      id,
      type: type as ResponseActionType,
      status: actionStatus as ResponseActionStatus,
      order,
      createdAt: nonEmptyString(entry.createdAt, "response action createdAt"),
      completedAt: optionalString(entry.completedAt, "response action completedAt"),
    });
  }

  return {
    status: status as IncidentResponseMeta["status"],
    startedAt,
    updatedAt,
    currentActionType,
    executionArn,
    actions,
  };
}

function canonicalizeTimelineEvent(
  value: unknown,
  incidentId: string
): {
  id: string;
  incidentId: string;
  type: TimelineEventType;
  tone: TimelineTone;
  label: string;
  detail?: string;
  occurredAt: string;
} {
  if (!isRecord(value)) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "timeline contains an invalid event."
    );
  }
  const id = isString(value.id) && ENTITY_ID_RE.test(value.id) ? value.id : undefined;
  if (!id || id.startsWith("tl_") === false || value.incidentId !== incidentId) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "timeline contains an event that does not belong to this incident."
    );
  }
  const type = isString(value.type) ? value.type : undefined;
  if (!type || !TIMELINE_TYPES.includes(type as TimelineEventType)) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "timeline event type is invalid."
    );
  }
  const tone = isString(value.tone) ? value.tone : "info";
  if (!TIMELINE_TONES.includes(tone as TimelineTone)) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "timeline event tone is invalid."
    );
  }
  return {
    id,
    incidentId,
    type: type as TimelineEventType,
    tone: tone as TimelineTone,
    label: nonEmptyString(value.label, "timeline.label", 256),
    detail: optionalString(value.detail, "timeline.detail", 1024),
    occurredAt: nonEmptyString(value.occurredAt, "timeline.occurredAt"),
  };
}

const INCIDENT_CORRELATION_STATUSES: readonly string[] = [
  "not_ready",
  "correlating",
  "correlated",
  "correlation_failed",
];
const INCIDENT_READINESS_STATES: readonly string[] = [
  "ready",
  "processing",
  "extraction_failed",
  "no_text_found",
  "not_extracted",
  "preserved_extraction_unavailable",
  "text_unavailable",
  "unsupported_media",
];

function canonicalizeNotReadyEvidence(
  value: unknown
): CorrelationNotReadyEvidence {
  if (!isRecord(value)) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "correlation contains an invalid evidence readiness entry."
    );
  }
  const evidenceId = isString(value.evidenceId) ? value.evidenceId : undefined;
  if (
    !evidenceId ||
    evidenceId.startsWith("ev_") === false ||
    ENTITY_ID_RE.test(evidenceId) === false
  ) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "correlation readiness evidenceId is invalid."
    );
  }
  const state = isString(value.state) ? value.state : undefined;
  if (!state || !INCIDENT_READINESS_STATES.includes(state)) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "correlation readiness state is invalid."
    );
  }
  return {
    evidenceId,
    filename: optionalString(value.filename, "readiness.filename", 512),
    state: state as EvidenceCorrelationReadinessState,
    reason: optionalString(value.reason, "readiness.reason", 512) ?? "",
  };
}

const INCIDENT_CORRELATION_SIGNATURE_RE = /^[a-f0-9]{64}$/;

export function canonicalizeIncidentCorrelation(value: unknown): IncidentCorrelationMeta {
  if (!isRecord(value)) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "correlation is invalid."
    );
  }
  const status = isString(value.status) ? value.status : undefined;
  if (!status || !INCIDENT_CORRELATION_STATUSES.includes(status)) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "correlation.status is invalid."
    );
  }
  const signature = isString(value.signature) ? value.signature : undefined;
  if (!signature || !INCIDENT_CORRELATION_SIGNATURE_RE.test(signature)) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "correlation.signature is invalid."
    );
  }
  const evidenceCount = isFiniteNumber(value.evidenceCount)
    ? value.evidenceCount
    : undefined;
  if (
    evidenceCount === undefined ||
    evidenceCount < 0 ||
    evidenceCount > MAX_EVIDENCE_RECORDS
  ) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "correlation.evidenceCount is invalid."
    );
  }
  const readyCount = isFiniteNumber(value.readyCount) ? value.readyCount : 0;
  if (
    readyCount < 0 ||
    readyCount > evidenceCount
  ) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "correlation.readyCount is invalid."
    );
  }
  const sourceEvidenceIdsInput = Array.isArray(value.sourceEvidenceIds)
    ? value.sourceEvidenceIds
    : [];
  if (sourceEvidenceIdsInput.length > evidenceCount) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "correlation.sourceEvidenceIds has too many entries."
    );
  }
  const sourceEvidenceIds: string[] = [];
  for (const entry of sourceEvidenceIdsInput) {
    if (
      isString(entry) &&
      entry.startsWith("ev_") &&
      ENTITY_ID_RE.test(entry)
    ) {
      sourceEvidenceIds.push(entry);
    }
  }

  const notReadyInput = Array.isArray(value.notReadyEvidence)
    ? value.notReadyEvidence
    : [];
  if (
    notReadyInput.length > MAX_EVIDENCE_RECORDS ||
    notReadyInput.length > evidenceCount
  ) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "correlation.notReadyEvidence has too many entries."
    );
  }
  const notReadyEvidence = notReadyInput.map(canonicalizeNotReadyEvidence);

  const correlation: IncidentCorrelationMeta = {
    status: status as IncidentCorrelationStatus,
    signature,
    evidenceCount,
    readyCount,
    sourceEvidenceIds,
    notReadyEvidence,
  };

  correlation.startedAt = optionalString(value.startedAt, "correlation.startedAt");
  correlation.correlatedAt = optionalString(value.correlatedAt, "correlation.correlatedAt");
  correlation.modelId = optionalString(value.modelId, "correlation.modelId", 256);
  correlation.durationMs = isFiniteNumber(value.durationMs)
    ? value.durationMs
    : undefined;
  correlation.textLength = isFiniteNumber(value.textLength)
    ? value.textLength
    : undefined;

  if (status === "correlation_failed") {
    if (!isRecord(value.error)) {
      throw new PersistenceServiceError(
        "INVALID_REQUEST",
        "correlation.error is required when correlation failed."
      );
    }
    const errorCode = optionalString(value.error.code, "correlation.error.code", 128);
    if (!errorCode || !CORRELATION_ERROR_CODES.includes(errorCode)) {
      throw new PersistenceServiceError(
        "INVALID_REQUEST",
        "correlation.error.code is invalid."
      );
    }
    correlation.error = {
      code: errorCode as CorrelationErrorCode,
      message:
        optionalString(value.error.message, "correlation.error.message", 512) ?? "",
    };
  }

  if (status === "correlated") {
    if (!isRecord(value.analysis)) {
      throw new PersistenceServiceError(
        "INVALID_REQUEST",
        "correlation.analysis is required when correlation completed."
      );
    }
    const analysis = canonicalizeCorrelationAnalysis(value.analysis);
    if (!analysis) {
      throw new PersistenceServiceError(
        "INVALID_REQUEST",
        "correlation.analysis is invalid."
      );
    }
    correlation.analysis = analysis;
  } else if (isRecord(value.analysis)) {
    const analysis = canonicalizeCorrelationAnalysis(value.analysis);
    if (analysis) {
      correlation.analysis = analysis;
    }
  }

  return correlation;
}

export function canonicalizeWorkspaceRecord(
  input: unknown,
  expectedIncidentId?: string
): IncidentWorkspaceRecord {
  if (!isRecord(input)) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "The incident payload is invalid."
    );
  }
  const incidentId = isString(input.incidentId) ? input.incidentId : undefined;
  if (!isValidIncidentId(incidentId)) {
    throw new PersistenceServiceError(
      "INVALID_INCIDENT",
      "The incident id is not valid."
    );
  }
  if (
    expectedIncidentId !== undefined &&
    incidentId !== expectedIncidentId
  ) {
    throw new PersistenceServiceError(
      "INVALID_INCIDENT",
      "The incident id does not match the requested id."
    );
  }

  const schemaVersion = input.schemaVersion;
  if (schemaVersion !== PERSISTENCE_SCHEMA_VERSION) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "The incident schema version is not supported."
    );
  }

  const status = isString(input.status) ? input.status : undefined;
  if (!status || !INCIDENT_STATUSES.includes(status)) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "The incident status is invalid."
    );
  }
  const type = isString(input.type) ? input.type : undefined;
  if (!type || !INCIDENT_TYPES.includes(type)) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "The incident type is invalid."
    );
  }

  const amount = input.amount === null || input.amount === undefined
    ? null
    : nonEmptyString(input.amount, "amount", 256);

  const createdAt = nonEmptyString(input.createdAt, "createdAt");
  const startedAt = nonEmptyString(input.startedAt, "startedAt");
  const updatedAt = nonEmptyString(input.updatedAt, "updatedAt");

  const evidenceInput = Array.isArray(input.evidence) ? input.evidence : [];
  if (evidenceInput.length > MAX_EVIDENCE_RECORDS) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "Too many evidence records."
    );
  }
  const evidence = evidenceInput.map((entry) =>
    canonicalizeEvidence(entry, incidentId)
  );

  const timelineInput = Array.isArray(input.timeline) ? input.timeline : [];
  if (timelineInput.length > MAX_TIMELINE_EVENTS) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "Too many timeline events."
    );
  }
  const timeline = timelineInput.map((entry) =>
    canonicalizeTimelineEvent(entry, incidentId)
  );

  const response =
    input.response === undefined || input.response === null
      ? undefined
      : canonicalizeResponse(input.response);

  const correlation =
    input.correlation === undefined || input.correlation === null
      ? undefined
      : canonicalizeIncidentCorrelation(input.correlation);

  return {
    incidentId,
    schemaVersion: PERSISTENCE_SCHEMA_VERSION,
    status: status as IncidentStatus,
    type: type as IncidentType,
    amount,
    createdAt,
    startedAt,
    updatedAt,
    evidence,
    timeline,
    nextAction: canonicalizeNextAction(input.nextAction),
    ...(response ? { response } : {}),
    ...(correlation ? { correlation } : {}),
  };
}

export function assertPersistenceConfigured(): void {
  if (!hasPersistenceConfiguration()) {
    throw new PersistenceServiceError(
      "DYNAMODB_NOT_CONFIGURED",
      "Incident persistence is not configured for this environment."
    );
  }
}

function mapDynamoErrors(error: unknown): never {
  if (error instanceof PersistenceServiceError) {
    throw error;
  }
  if (error instanceof DynamoDbConflictError) {
    throw error;
  }
  if (error instanceof DynamoDbServiceError) {
    throw new PersistenceServiceError(error.code, error.safeMessage);
  }
  throw new PersistenceServiceError(
    "DYNAMODB_REQUEST_FAILED",
    "The incident store could not be reached. Please try again."
  );
}

export interface SaveIncidentResult {
  record: IncidentWorkspaceRecord;
  conflict: boolean;
}

export async function saveIncident(
  input: unknown,
  expectedIncidentId?: string
): Promise<SaveIncidentResult> {
  assertPersistenceConfigured();
  const record = canonicalizeWorkspaceRecord(input, expectedIncidentId);
  try {
    const existing = await readIncidentRecord(record.incidentId);
    let timeline = record.timeline;
    if (existing && existing.timeline.length > 0) {
      timeline = [...record.timeline];
      for (const existingEvent of existing.timeline) {
        const alreadyPresent = timeline.some(
          (candidate) =>
            candidate.id === existingEvent.id ||
            (candidate.type === existingEvent.type &&
              candidate.detail === existingEvent.detail &&
              candidate.occurredAt === existingEvent.occurredAt)
        );
        if (!alreadyPresent) {
          timeline.push(existingEvent);
        }
      }
    }
    const toWrite = {
      ...record,
      ...(existing?.response ? { response: existing.response } : {}),
      ...(existing?.correlation ? { correlation: existing.correlation } : {}),
      timeline,
    };
    await writeIncidentRecord(toWrite);
    return { record: toWrite, conflict: false };
  } catch (error) {
    if (error instanceof DynamoDbConflictError) {
      return { record, conflict: true };
    }
    mapDynamoErrors(error);
  }
}

export async function getIncident(
  incidentId: string
): Promise<IncidentWorkspaceRecord | null> {
  if (!isValidIncidentId(incidentId)) {
    throw new PersistenceServiceError(
      "INVALID_INCIDENT",
      "The incident id is not valid."
    );
  }
  assertPersistenceConfigured();
  try {
    const stored = await readIncidentRecord(incidentId);
    if (!stored) return null;
    return canonicalizeWorkspaceRecord(stored);
  } catch (error) {
    mapDynamoErrors(error);
  }
}

export async function updateIncident(
  incidentId: string,
  patch: Partial<
    Pick<
      IncidentWorkspaceRecord,
      "status" | "type" | "amount" | "updatedAt" | "evidence" | "timeline" | "nextAction"
    >
  >
): Promise<IncidentWorkspaceRecord | null> {
  if (!isValidIncidentId(incidentId)) {
    throw new PersistenceServiceError(
      "INVALID_INCIDENT",
      "The incident id is not valid."
    );
  }
  assertPersistenceConfigured();
  try {
    const current = await readIncidentRecord(incidentId);
    if (!current) return null;

    const merged = {
      ...current,
      ...patch,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    };
    const canonical = canonicalizeWorkspaceRecord(merged);
    await writeIncidentRecord(canonical);
    return canonical;
  } catch (error) {
    mapDynamoErrors(error);
  }
}

export async function appendTimelineEvent(
  incidentId: string,
  event: {
    id: string;
    type: TimelineEventType;
    tone: TimelineTone;
    label: string;
    detail?: string;
    occurredAt: string;
  }
): Promise<IncidentWorkspaceRecord | null> {
  if (!isValidIncidentId(incidentId)) {
    throw new PersistenceServiceError(
      "INVALID_INCIDENT",
      "The incident id is not valid."
    );
  }
  assertPersistenceConfigured();
  try {
    const current = await readIncidentRecord(incidentId);
    if (!current) return null;

    const alreadyPresent = current.timeline.some(
      (existing) =>
        existing.id === event.id ||
        (existing.type === event.type &&
          existing.detail === event.detail &&
          existing.occurredAt === event.occurredAt)
    );
    if (alreadyPresent) {
      return current;
    }

    const canonicalEvent = canonicalizeTimelineEvent(
      {
        ...event,
        incidentId,
        label: event.label,
      },
      incidentId
    );

    const next = {
      ...current,
      timeline: [...current.timeline, canonicalEvent],
      updatedAt:
        canonicalEvent.occurredAt > current.updatedAt
          ? canonicalEvent.occurredAt
          : current.updatedAt,
    };
    const canonical = canonicalizeWorkspaceRecord(next);
    await writeIncidentRecord(canonical, current.updatedAt);

    const refreshed = await readIncidentRecord(incidentId);
    return refreshed ? canonicalizeWorkspaceRecord(refreshed) : canonical;
  } catch (error) {
    mapDynamoErrors(error);
  }
}

export async function deleteIncident(incidentId: string): Promise<void> {
  if (!isValidIncidentId(incidentId)) {
    throw new PersistenceServiceError(
      "INVALID_INCIDENT",
      "The incident id is not valid."
    );
  }
  assertPersistenceConfigured();
  try {
    await deleteIncidentRecord(incidentId);
  } catch (error) {
    mapDynamoErrors(error);
  }
}