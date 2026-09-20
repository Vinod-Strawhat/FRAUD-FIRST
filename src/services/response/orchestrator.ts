import type {
  IncidentResponseMeta,
  PersistentResponseAction,
  ResponseAction,
  ResponseActionType,
} from "@/types";
import { RESPONSE_ACTION_SEQUENCE } from "./sequence";

export const RESPONSE_ACTION_ID_PREFIX = "resp_";

export function responseActionId(type: ResponseActionType): string {
  return `${RESPONSE_ACTION_ID_PREFIX}${type}`;
}

export function buildResponseActions(
  incidentId: string,
  startedAt: string
): ResponseAction[] {
  return RESPONSE_ACTION_SEQUENCE.map((definition, index) => ({
    id: responseActionId(definition.type),
    incidentId,
    type: definition.type,
    title: definition.title,
    description: definition.description,
    status: "pending",
    priority: definition.priority,
    createdAt: startedAt,
    order: index + 1,
  }));
}

export function compactResponseActions(
  actions: ResponseAction[]
): PersistentResponseAction[] {
  return actions.map((action) => ({
    id: action.id,
    type: action.type,
    status: action.status,
    order: action.order,
    createdAt: action.createdAt,
    completedAt: action.completedAt,
  }));
}

export function buildResponsePlan(
  incidentId: string,
  startedAt: string,
  executionArn?: string
): IncidentResponseMeta {
  const actions = buildResponseActions(incidentId, startedAt);
  const first = actions[0];
  return {
    status: "running",
    startedAt,
    updatedAt: startedAt,
    currentActionType: first ? first.type : null,
    executionArn,
    actions: compactResponseActions(actions),
  };
}

export interface CompleteResponseActionResult {
  ok: true;
  next: IncidentResponseMeta;
  completedActionType: ResponseActionType;
  workflowCompleted: boolean;
}

export interface CompleteResponseActionFailure {
  ok: false;
  code: "ACTION_NOT_FOUND" | "ACTION_NOT_CURRENT" | "ACTION_ALREADY_COMPLETED";
  message: string;
}

export type CompleteResponseActionOutcome =
  | CompleteResponseActionResult
  | CompleteResponseActionFailure;

export function completeResponseAction(
  meta: IncidentResponseMeta,
  actionId: string,
  nowIso: string
): CompleteResponseActionOutcome {
  const index = meta.actions.findIndex((action) => action.id === actionId);
  if (index < 0) {
    return {
      ok: false,
      code: "ACTION_NOT_FOUND",
      message: "The action does not exist in this response plan.",
    };
  }

  const action = meta.actions[index];
  if (action.status === "completed" || action.status === "skipped") {
    return {
      ok: false,
      code: "ACTION_ALREADY_COMPLETED",
      message: "This action has already been completed.",
    };
  }

  if (action.type !== meta.currentActionType) {
    return {
      ok: false,
      code: "ACTION_NOT_CURRENT",
      message: "Earlier pending actions must be completed before this one.",
    };
  }

  const actions = [...meta.actions];
  actions[index] = {
    ...action,
    status: "completed",
    completedAt: nowIso,
  };

  const nextPending = actions.find((entry) => entry.status === "pending");

  return {
    ok: true,
    next: {
      ...meta,
      status: nextPending ? "running" : "completed",
      currentActionType: nextPending ? nextPending.type : null,
      updatedAt: nowIso,
      actions,
    },
    completedActionType: action.type,
    workflowCompleted: !nextPending,
  };
}

export function responseProgress(meta: IncidentResponseMeta): {
  completed: number;
  total: number;
  remaining: number;
} {
  const completed = meta.actions.filter(
    (action) =>
      action.status === "completed" || action.status === "skipped"
  ).length;
  const total = meta.actions.length;
  return { completed, total, remaining: Math.max(0, total - completed) };
}