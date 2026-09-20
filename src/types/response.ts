export type ResponseActionType =
  | "preserve_evidence"
  | "contact_bank"
  | "contact_1930"
  | "report_cybercrime"
  | "follow_up";

export type ResponseActionStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "skipped";

export type ResponseWorkflowStatus =
  | "not_started"
  | "running"
  | "completed"
  | "failed";

export type ResponseExecutionState =
  | "NOT_STARTED"
  | "STARTING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "STOPPED";

export type ResponseActionPriority = "critical" | "high" | "normal";

export interface ResponseAction {
  id: string;
  incidentId: string;
  type: ResponseActionType;
  title: string;
  description: string;
  status: ResponseActionStatus;
  priority: ResponseActionPriority;
  createdAt: string;
  completedAt?: string;
  order: number;
}

export interface PersistentResponseAction {
  id: string;
  type: ResponseActionType;
  status: ResponseActionStatus;
  order: number;
  createdAt: string;
  completedAt?: string;
}

export interface IncidentResponseMeta {
  status: Exclude<ResponseWorkflowStatus, "not_started">;
  startedAt: string;
  updatedAt: string;
  currentActionType: ResponseActionType | null;
  executionArn?: string;
  actions: PersistentResponseAction[];
}

export interface ResponseActionView extends PersistentResponseAction {
  incidentId: string;
  title: string;
  description: string;
  priority: ResponseActionPriority;
  guidance: string;
}

export interface IncidentResponseView {
  status: Exclude<ResponseWorkflowStatus, "not_started">;
  startedAt: string;
  updatedAt: string;
  currentActionType: ResponseActionType | null;
  executionArn?: string;
  executionStatus?: ResponseExecutionState;
  actions: ResponseActionView[];
}

export type ResponseErrorCode =
  | "INCIDENT_NOT_FOUND"
  | "RESPONSE_ALREADY_STARTED"
  | "RESPONSE_NOT_FOUND"
  | "STEP_FUNCTIONS_NOT_CONFIGURED"
  | "STEP_FUNCTIONS_REQUEST_FAILED"
  | "ACTION_NOT_FOUND"
  | "ACTION_NOT_CURRENT"
  | "ACTION_ALREADY_COMPLETED"
  | "DYNAMODB_NOT_CONFIGURED"
  | "DYNAMODB_REQUEST_FAILED"
  | "INVALID_REQUEST"
  | "INVALID_INCIDENT";

export interface ResponseError {
  code: ResponseErrorCode;
  message: string;
}

export interface StartResponseSuccessResponse {
  ok: true;
  response: IncidentResponseView;
}

export interface StartResponseErrorResponse {
  ok: false;
  error: ResponseError;
}

export type StartResponseResult =
  | StartResponseSuccessResponse
  | StartResponseErrorResponse;

export interface GetResponseSuccessResponse {
  ok: true;
  response: IncidentResponseView;
}

export interface GetResponseErrorResponse {
  ok: false;
  error: ResponseError;
}

export type GetResponseResult = GetResponseSuccessResponse | GetResponseErrorResponse;

export interface CompleteResponseActionSuccessResponse {
  ok: true;
  response: IncidentResponseView;
}

export interface CompleteResponseActionErrorResponse {
  ok: false;
  error: ResponseError;
}

export type CompleteResponseActionResult =
  | CompleteResponseActionSuccessResponse
  | CompleteResponseActionErrorResponse;