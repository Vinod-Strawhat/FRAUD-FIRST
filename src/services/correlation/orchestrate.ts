import {
  assertPersistenceConfigured,
  canonicalizeIncidentCorrelation,
  getIncident,
  PersistenceServiceError,
  appendTimelineEvent,
  isValidIncidentId,
} from "@/services/incident-persistence";
import { writeIncidentRecord, DynamoDbConflictError } from "@/services/server/dynamodb";
import {
  correlateEvidenceBatch,
  CORRELATION_HARD_LIMIT_CHARS,
  CORRELATION_BATCH_TOTAL_CHARS,
  CorrelationServiceError,
} from "@/services/correlation";
import { BedrockRuntimeError } from "@/services/server/bedrock";
import { OpenRouterRuntimeError } from "@/services/server/openrouter";
import {
  getCorrelationReadyEvidence,
  type CorrelationReadyItem,
  type ReadinessEntry,
} from "@/services/correlation/evidence-bridge";
import type {
  CorrelationError,
  CorrelationErrorCode,
  CorrelationProviderMode,
  CorrelationProviderName,
  CorrelationTextClaim,
  IncidentCorrelationMeta,
  IncidentWorkspaceRecord,
} from "@/types";

export const INCIDENT_CORRELATION_STALE_MS = 2 * 60_000;

export interface CorrelateIncidentProviderInput {
  incidentId: string;
  evidenceId: string;
  filename: string;
  mimeType: string;
  category: string;
  capturedAt?: string;
  extractedAt?: string;
  source?: string;
  confidence?: number;
  status: "processed";
  text: string;
}

export interface CorrelateIncidentProviderResult {
  modelId: string;
  durationMs: number;
  textLength: number;
  analysis: IncidentCorrelationMeta["analysis"];
  provider?: CorrelationProviderName;
  providerMode?: CorrelationProviderMode;
}

export type CorrelateIncidentProvider = (
  items: CorrelateIncidentProviderInput[]
) => Promise<CorrelateIncidentProviderResult>;

const DEFAULT_PROVIDER_RESULT: CorrelateIncidentProviderResult = {
  modelId: "",
  durationMs: 0,
  textLength: 0,
  analysis: undefined,
};

function errorBody(code: CorrelationErrorCode, message: string): CorrelationError {
  return { code, message };
}

function capReadyText(items: CorrelationReadyItem[]): CorrelationReadyItem[] {
  let remaining = CORRELATION_BATCH_TOTAL_CHARS;
  return items.map((item) => {
    const perItem = Math.min(CORRELATION_HARD_LIMIT_CHARS, remaining);
    const text = item.text.slice(0, perItem);
    remaining = Math.max(0, remaining - text.length);
    return { ...item, text };
  });
}

function metaFromEntries(
  status: IncidentCorrelationMeta["status"],
  signature: string,
  entries: ReadinessEntry[],
  extra: Partial<IncidentCorrelationMeta> = {}
): IncidentCorrelationMeta {
  const ready = entries.filter((entry) => entry.state === "ready");
  const notReadyEvidence = entries
    .filter((entry) => entry.state !== "ready")
    .map((entry) => ({
      evidenceId: entry.evidenceId,
      filename: entry.filename,
      state: entry.state,
      reason: entry.reason,
    }));
  return {
    status,
    signature,
    evidenceCount: entries.length,
    readyCount: ready.length,
    sourceEvidenceIds: ready.map((entry) => entry.evidenceId),
    notReadyEvidence,
    ...extra,
  };
}

async function persistIncidentCorrelation(
  incidentId: string,
  correlation: IncidentCorrelationMeta,
  updatedAt: string
): Promise<IncidentCorrelationMeta> {
  const writeFrom = async (current: IncidentWorkspaceRecord): Promise<void> => {
    const next: IncidentWorkspaceRecord = {
      ...current,
      correlation,
      updatedAt,
    };
    await writeIncidentRecord(next, current.updatedAt);
  };

  let current = await getIncident(incidentId);
  if (!current) {
    throw new PersistenceServiceError(
      "INCIDENT_NOT_FOUND",
      "The incident no longer exists."
    );
  }
  try {
    await writeFrom(current);
  } catch (error) {
    if (error instanceof DynamoDbConflictError) {
      current = await getIncident(incidentId);
      if (!current) {
        throw new PersistenceServiceError(
          "INCIDENT_NOT_FOUND",
          "The incident no longer exists."
        );
      }
      await writeFrom(current);
    } else {
      throw error;
    }
  }
  return canonicalizeIncidentCorrelation(correlation);
}

export async function correlateIncidentEvidence(
  incidentId: string,
  claims: CorrelationTextClaim[] = [],
  provider: CorrelateIncidentProvider = async (items) => {
    const result = await correlateEvidenceBatch(items);
    return {
      modelId: result.modelId,
      durationMs: result.durationMs,
      textLength: result.textLength,
      analysis: result.analysis,
    };
  }
): Promise<IncidentCorrelationMeta> {
  if (!isValidIncidentId(incidentId)) {
    throw new PersistenceServiceError(
      "INVALID_INCIDENT",
      "The incident id is not valid."
    );
  }
  assertPersistenceConfigured();

  const model = await getCorrelationReadyEvidence(incidentId, claims);
  const { existing, entries, signature } = model;
  const now = new Date().toISOString();

  if (existing) {
    if (existing.status === "correlating") {
      const isStaleCorrelating =
        existing.startedAt !== undefined &&
        Date.now() - Date.parse(existing.startedAt) > INCIDENT_CORRELATION_STALE_MS;
      if (!isStaleCorrelating) {
        return existing;
      }
    } else if (
      existing.signature === signature &&
      (existing.status === "correlated" || existing.status === "not_ready")
    ) {
      return existing;
    }
  }

  const readyItems = capReadyText(model.readyItems);
  const notReadyMeta = metaFromEntries("not_ready", signature, entries);

  if (readyItems.length === 0) {
    if (existing?.status === "correlated") {
      return existing;
    }
    return persistIncidentCorrelation(incidentId, notReadyMeta, now);
  }

  const correlatingMeta = metaFromEntries("correlating", signature, entries, {
    startedAt: now,
  });
  await persistIncidentCorrelation(incidentId, correlatingMeta, now);

  await appendTimelineEvent(incidentId, {
    id: `tl_${incidentId}_correlation_start`,
    type: "correlation_started",
    tone: "info",
    label: "Incident correlation started",
    detail: `${readyItems.length} evidence item(s) ready`,
    occurredAt: now,
  });

  let result: CorrelateIncidentProviderResult = DEFAULT_PROVIDER_RESULT;
  try {
    result = await provider(readyItems);
  } catch (error) {
    const correlationError = mapCorrelationFailure(error);
    const previousSuccess =
      existing && existing.analysis
        ? {
            correlatedAt: existing.correlatedAt,
            modelId: existing.modelId,
            durationMs: existing.durationMs,
            textLength: existing.textLength,
            analysis: existing.analysis,
          }
        : {};
    const failedMeta = metaFromEntries(
      "correlation_failed",
      signature,
      entries,
      {
        startedAt: now,
        error: correlationError,
        ...previousSuccess,
      }
    );
    const failedAt = new Date().toISOString();
    await persistIncidentCorrelation(incidentId, failedMeta, failedAt);
    await appendTimelineEvent(incidentId, {
      id: `tl_${incidentId}_correlation_failed`,
      type: "correlation_failed",
      tone: "warn",
      label: "Incident correlation failed",
      detail: `${correlationError.code}: ${correlationError.message}`,
      occurredAt: failedAt,
    });
    return failedMeta;
  }

  const completedAt = new Date().toISOString();
  const completedMeta = metaFromEntries(
    "correlated",
    signature,
    entries,
    {
      startedAt: now,
      correlatedAt: completedAt,
      modelId: result.modelId,
      durationMs: result.durationMs,
      textLength: result.textLength,
      analysis: result.analysis,
      provider: result.provider,
      providerMode: result.providerMode,
    }
  );
  await persistIncidentCorrelation(incidentId, completedMeta, completedAt);
  await appendTimelineEvent(incidentId, {
    id: `tl_${incidentId}_correlation_complete`,
    type: "correlation_completed",
    tone: "info",
    label: "Incident correlation completed",
    detail: `${result.analysis?.facts.length ?? 0} fact(s) from ${readyItems.length} evidence item(s)`,
    occurredAt: completedAt,
  });

  return completedMeta;
}

function mapCorrelationFailure(error: unknown): CorrelationError {
  if (error instanceof CorrelationServiceError) {
    return error.toError();
  }
  if (error instanceof BedrockRuntimeError) {
    return errorBody("BEDROCK_REQUEST_FAILED", error.message);
  }
  if (error instanceof OpenRouterRuntimeError) {
    return errorBody("OPENROUTER_REQUEST_FAILED", error.message);
  }
  if (error instanceof PersistenceServiceError) {
    return errorBody(
      error.code === "INCIDENT_NOT_FOUND" ? "INCIDENT_NOT_FOUND" : "BEDROCK_REQUEST_FAILED",
      error.message
    );
  }
  return errorBody("BEDROCK_REQUEST_FAILED", "AI correlation failed. Try again.");
}