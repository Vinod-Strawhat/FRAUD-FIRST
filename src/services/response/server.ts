import type {
  IncidentResponseMeta,
  IncidentResponseView,
  IncidentWorkspaceRecord,
  ResponseActionStatus,
  ResponseError,
  ResponseErrorCode,
  ResponseExecutionState,
} from "@/types";
import {
  DynamoDbConflictError,
  DynamoDbServiceError,
  clearResponseTaskToken,
  readResponseTaskToken,
  writeIncidentRecord,
} from "@/services/server/dynamodb";
import {
  StepFunctionsServiceError,
  describeResponseExecution,
  hasStepFunctionsConfiguration,
  sendTaskSuccess,
  startResponseExecution,
  type ResponseExecutionInput,
} from "@/services/server/step-functions";
import {
  appendTimelineEvent,
  canonicalizeWorkspaceRecord,
  getIncident,
  isValidIncidentId,
  PersistenceServiceError,
} from "@/services/incident-persistence";
import { responseActionDefinition } from "./sequence";
import { buildResponsePlan, completeResponseAction } from "./orchestrator";

export class ResponseServiceError extends Error {
  readonly code: ResponseErrorCode;

  constructor(code: ResponseErrorCode, message: string) {
    super(message);
    this.name = "ResponseServiceError";
    this.code = code;
  }

  toError(): ResponseError {
    return { code: this.code, message: this.message };
  }
}

function mapError(error: unknown): never {
  if (error instanceof ResponseServiceError) {
    throw error;
  }
  if (error instanceof PersistenceServiceError) {
    const code: ResponseErrorCode =
      error.code === "INCIDENT_NOT_FOUND"
        ? "INCIDENT_NOT_FOUND"
        : error.code === "DYNAMODB_NOT_CONFIGURED"
          ? "DYNAMODB_NOT_CONFIGURED"
          : error.code === "DYNAMODB_REQUEST_FAILED"
            ? "DYNAMODB_REQUEST_FAILED"
            : error.code === "INVALID_INCIDENT"
              ? "INVALID_INCIDENT"
              : "INVALID_REQUEST";
    throw new ResponseServiceError(code, error.message);
  }
  if (error instanceof StepFunctionsServiceError) {
    throw new ResponseServiceError(error.code, error.safeMessage);
  }
  if (error instanceof DynamoDbServiceError) {
    throw new ResponseServiceError(
      error.code === "DYNAMODB_NOT_CONFIGURED"
        ? "DYNAMODB_NOT_CONFIGURED"
        : "DYNAMODB_REQUEST_FAILED",
      error.safeMessage
    );
  }
  throw new ResponseServiceError(
    "STEP_FUNCTIONS_REQUEST_FAILED",
    "The response workflow could not be reached. Please try again."
  );
}

function buildResponseView(
  meta: IncidentResponseMeta,
  incidentId: string,
  executionStatus?: ResponseExecutionState
): IncidentResponseView {
  return {
    status: meta.status,
    startedAt: meta.startedAt,
    updatedAt: meta.updatedAt,
    currentActionType: meta.currentActionType,
    executionArn: meta.executionArn,
    ...(executionStatus ? { executionStatus } : {}),
    actions: meta.actions.map((action) => {
      const definition = responseActionDefinition(action.type);
      return {
        ...action,
        incidentId,
        title: definition.title,
        description: definition.description,
        priority: definition.priority,
        guidance: definition.guidance,
      };
    }),
  };
}

function toExecutionState(sfnStatus: string): ResponseExecutionState {
  switch (sfnStatus) {
    case "SUCCEEDED":
      return "COMPLETED";
    case "FAILED":
      return "FAILED";
    case "ABORTED":
      return "STOPPED";
    case "TIMED_OUT":
      return "FAILED";
    default:
      return "RUNNING";
  }
}

function executionStateFromMeta(meta: IncidentResponseMeta): ResponseExecutionState {
  switch (meta.status) {
    case "completed":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    default:
      return "RUNNING";
  }
}

async function withConflictRetry<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof DynamoDbConflictError) {
      return await task();
    }
    throw error;
  }
}

async function requireIncidentRecord(
  incidentId: string
): Promise<IncidentWorkspaceRecord> {
  const incident = await getIncident(incidentId);
  if (!incident) {
    throw new ResponseServiceError(
      "INCIDENT_NOT_FOUND",
      "No incident exists with this id."
    );
  }
  return incident;
}

async function writeWithRetry(
  record: IncidentWorkspaceRecord,
  expectedUpdatedAt: string
): Promise<IncidentWorkspaceRecord> {
  return withConflictRetry(async () => {
    try {
      await writeIncidentRecord(record, expectedUpdatedAt);
      return record;
    } catch (error) {
      if (error instanceof DynamoDbConflictError) {
        throw error;
      }
      mapError(error);
    }
  });
}

export async function startIncidentResponse(
  incidentId: string
): Promise<IncidentResponseView> {
  if (!isValidIncidentId(incidentId)) {
    throw new ResponseServiceError("INVALID_INCIDENT", "The incident id is not valid.");
  }
  const snapshot = await requireIncidentRecord(incidentId);

  const existing = snapshot.response;
  if (existing && existing.status !== "failed") {
    return buildResponseView(
      existing,
      incidentId,
      executionStateFromMeta(existing)
    );
  }

  if (!hasStepFunctionsConfiguration()) {
    throw new ResponseServiceError(
      "STEP_FUNCTIONS_NOT_CONFIGURED",
      "Step Functions is not configured for this environment."
    );
  }

  const nowIso = new Date().toISOString();
  const claim = buildResponsePlan(incidentId, nowIso);

  const claimed = await withConflictRetry(async () => {
    const fresh = await requireIncidentRecord(incidentId);
    if (fresh.response && fresh.response.status !== "failed") {
      return { claimed: false, record: fresh };
    }
    const candidate = {
      ...fresh,
      response: claim,
      updatedAt: nowIso > fresh.updatedAt ? nowIso : fresh.updatedAt,
    };
    const written = await writeWithRetry(
      canonicalizeWorkspaceRecord(candidate),
      fresh.updatedAt
    );
    return { claimed: true, record: written };
  });

  const claimedMeta = claimed.record.response;
  if (!claimedMeta) {
    throw new ResponseServiceError(
      "STEP_FUNCTIONS_REQUEST_FAILED",
      "The response workflow did not complete initialization."
    );
  }
  if (!claimed.claimed) {
    return buildResponseView(
      claimedMeta,
      incidentId,
      executionStateFromMeta(claimedMeta)
    );
  }

  const input: ResponseExecutionInput = {
    incidentId,
    startedAt: snapshot.startedAt,
    currentAction: claimedMeta.currentActionType ?? "preserve_evidence",
    amount: snapshot.amount,
    currency: "INR",
  };

  let executionArn: string;
  try {
    executionArn = await startResponseExecution(input);
  } catch (error) {
    await markClaimFailed(incidentId, claimedMeta.startedAt);
    throw error;
  }

  let finalMeta = claimedMeta;
  await withConflictRetry(async () => {
    const fresh = await requireIncidentRecord(incidentId);
    if (!fresh.response || fresh.response.startedAt !== claimedMeta.startedAt) {
      return;
    }
    finalMeta = { ...fresh.response, executionArn };
    const candidate = {
      ...fresh,
      response: finalMeta,
      updatedAt: fresh.updatedAt,
    };
    await writeWithRetry(canonicalizeWorkspaceRecord(candidate), fresh.updatedAt);
  }).catch(() => null);

  await appendTimelineEvent(incidentId, {
    id: `tl_${incidentId}_response_start`,
    type: "response_started",
    tone: "critical",
    label: "Response plan started",
    detail: summaryDetail(executionArn),
    occurredAt: claimedMeta.startedAt,
  }).catch(() => null);

  return buildResponseView(finalMeta, incidentId, "RUNNING");
}

async function markClaimFailed(
  incidentId: string,
  claimedStartedAt: string
): Promise<void> {
  await withConflictRetry(async () => {
    const fresh = await requireIncidentRecord(incidentId).catch(() => null);
    if (!fresh?.response || fresh.response.startedAt !== claimedStartedAt) return;
    const failed = {
      ...fresh.response,
      status: "failed" as const,
      updatedAt: new Date().toISOString(),
    };
    const candidate = {
      ...fresh,
      response: failed,
      updatedAt: fresh.updatedAt,
    };
    await writeWithRetry(canonicalizeWorkspaceRecord(candidate), fresh.updatedAt);
  }).catch(() => null);
}

export async function getIncidentResponse(
  incidentId: string
): Promise<IncidentResponseView> {
  if (!isValidIncidentId(incidentId)) {
    throw new ResponseServiceError("INVALID_INCIDENT", "The incident id is not valid.");
  }
  const resolved = await resolveIncidentResponse(incidentId);
  return buildResponseView(resolved.meta, incidentId, resolved.executionStatus);
}

interface ResolvedIncidentResponse {
  meta: IncidentResponseMeta;
  executionStatus?: ResponseExecutionState;
}

async function resolveIncidentResponse(
  incidentId: string
): Promise<ResolvedIncidentResponse> {
  const incident = await requireIncidentRecord(incidentId);
  const meta = incident.response;
  if (!meta) {
    throw new ResponseServiceError(
      "RESPONSE_NOT_FOUND",
      "No response workflow has been started for this incident."
    );
  }

  if (!hasStepFunctionsConfiguration() || !meta.executionArn) {
    return { meta, executionStatus: executionStateFromMeta(meta) };
  }

  let executionStatus: ResponseExecutionState;
  try {
    const { status } = await describeResponseExecution(meta.executionArn);
    executionStatus = toExecutionState(status);
  } catch {
    executionStatus = executionStateFromMeta(meta);
    return { meta, executionStatus };
  }

  if (executionStatus === "COMPLETED" && meta.status !== "completed") {
    const reconciled = await reconcileToCompleted(incidentId, meta);
    return { meta: reconciled, executionStatus: "COMPLETED" };
  }

  if (executionStatus === "FAILED" && meta.status !== "failed") {
    const reconciled = await reconcileToTerminalFailure(incidentId, meta, false);
    return { meta: reconciled, executionStatus: "FAILED" };
  }

  if (executionStatus === "STOPPED" && meta.status !== "failed") {
    const reconciled = await reconcileToTerminalFailure(incidentId, meta, true);
    return { meta: reconciled, executionStatus: "STOPPED" };
  }

  return { meta, executionStatus };
}

async function reconcileToCompleted(
  incidentId: string,
  meta: IncidentResponseMeta
): Promise<IncidentResponseMeta> {
  const nowIso = new Date().toISOString();
  const reconciled: IncidentResponseMeta = {
    ...meta,
    status: "completed",
    currentActionType: null,
    updatedAt: nowIso,
    actions: meta.actions.map((action) =>
      action.status === "completed" || action.status === "skipped"
        ? action
        : {
            ...action,
            status: "completed" as ResponseActionStatus,
            completedAt: action.completedAt ?? nowIso,
          }
    ),
  };
  await persistResponseMeta(incidentId, reconciled);

  await appendTimelineEvent(incidentId, {
    id: `tl_${incidentId}_response_complete`,
    type: "response_completed",
    tone: "info",
    label: "Response plan complete",
    detail: "Reconciled with the completed response workflow.",
    occurredAt: nowIso,
  }).catch(() => null);

  return reconciled;
}

async function reconcileToTerminalFailure(
  incidentId: string,
  meta: IncidentResponseMeta,
  stopped: boolean
): Promise<IncidentResponseMeta> {
  const nowIso = new Date().toISOString();
  const reconciled: IncidentResponseMeta = {
    ...meta,
    status: "failed",
    updatedAt: nowIso,
  };
  await persistResponseMeta(incidentId, reconciled);

  const label = stopped
    ? "Response workflow stopped"
    : "Response workflow failed";
  const detail = stopped
    ? "The response workflow execution was stopped before all steps completed."
    : "The response workflow execution failed before all steps completed.";
  await appendTimelineEvent(incidentId, {
    id: `tl_${incidentId}_response_failed`,
    type: "response_failed",
    tone: "critical",
    label,
    detail,
    occurredAt: nowIso,
  }).catch(() => null);

  return reconciled;
}

async function persistResponseMeta(
  incidentId: string,
  reconciled: IncidentResponseMeta
): Promise<void> {
  await withConflictRetry(async () => {
    const current = await requireIncidentRecord(incidentId);
    if (!current.response) return;
    const candidate = {
      ...current,
      response: reconciled,
      updatedAt: reconciled.updatedAt > current.updatedAt
        ? reconciled.updatedAt
        : current.updatedAt,
    };
    await writeWithRetry(
      canonicalizeWorkspaceRecord(candidate),
      current.updatedAt
    );
  });
}

export async function completeIncidentResponseAction(
  incidentId: string,
  actionId: string
): Promise<IncidentResponseView> {
  if (!isValidIncidentId(incidentId)) {
    throw new ResponseServiceError("INVALID_INCIDENT", "The incident id is not valid.");
  }
  if (typeof actionId !== "string" || !actionId.startsWith("resp_")) {
    throw new ResponseServiceError(
      "INVALID_REQUEST",
      "The action id is not valid."
    );
  }
  await requireIncidentRecord(incidentId);

  const nowIso = new Date().toISOString();
  const outcome = await withConflictRetry(async () => {
    const current = await requireIncidentRecord(incidentId);
    const meta = current.response;
    if (!meta) {
      throw new ResponseServiceError(
        "RESPONSE_NOT_FOUND",
        "No response workflow has been started for this incident."
      );
    }
    if (meta.status === "completed") {
      throw new ResponseServiceError(
        "INVALID_REQUEST",
        "The response plan is already complete."
      );
    }
    const result = completeResponseAction(meta, actionId, nowIso);
    if (!result.ok) {
      throw new ResponseServiceError(result.code, result.message);
    }
    const candidate = {
      ...current,
      response: result.next,
      updatedAt: nowIso > current.updatedAt ? nowIso : current.updatedAt,
    };
    const canon = canonicalizeWorkspaceRecord(candidate);
    await writeWithRetry(canon, current.updatedAt);
    return { canonical: canon, result };
  });

  const completedType = outcome.result.completedActionType;
  const completedAt =
    outcome.canonical.response?.actions.find(
      (action) => action.type === completedType
    )?.completedAt ?? nowIso;

  await appendTimelineEvent(incidentId, {
    id: `tl_${incidentId}_action_${completedType}`,
    type: "response_action_completed",
    tone: "neutral",
    label: `Completed: ${responseActionDefinition(completedType).title}`,
    detail: `Marked complete by the user: ${completedType}`,
    occurredAt: completedAt,
  }).catch(() => null);

  if (outcome.result.workflowCompleted) {
    await appendTimelineEvent(incidentId, {
      id: `tl_${incidentId}_response_complete`,
      type: "response_completed",
      tone: "info",
      label: "Response plan complete",
      detail: "All response actions were marked complete by the user.",
      occurredAt: completedAt,
    }).catch(() => null);
  }

  await advanceStepFunctionsBestEffort(incidentId, completedType);

  const meta = outcome.canonical.response;
  if (!meta) {
    throw new ResponseServiceError(
      "DYNAMODB_REQUEST_FAILED",
      "The response plan could not be loaded after completion."
    );
  }
  return buildResponseView(meta, incidentId);
}

async function advanceStepFunctionsBestEffort(
  incidentId: string,
  actionType: string
): Promise<void> {
  const incident = await getIncident(incidentId).catch(() => null);
  const meta = incident?.response;
  if (!meta) return;
  try {
    const tokenRef = await readResponseTaskToken(incidentId);
    if (tokenRef?.taskToken) {
      await sendTaskSuccess(tokenRef.taskToken, {
        incidentId,
        actionType,
      });
    } else if (meta.executionArn) {
      await describeResponseExecution(meta.executionArn);
      return;
    }
    await clearResponseTaskToken(incidentId);
  } catch {
    return;
  }
}

function summaryDetail(executionArn: string): string {
  const tail = executionArn.split(":").pop()?.split("#").pop() ?? executionArn;
  const short = tail.length > 64 ? `${tail.slice(0, 32)}…` : tail;
  return `Step Functions execution ${short}`;
}