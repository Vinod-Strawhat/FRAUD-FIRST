import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { SFNClient } from "@aws-sdk/client-sfn";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  completeIncidentResponseAction,
  getIncidentResponse,
  startIncidentResponse,
} from "../src/services/response/server";
import {
  buildResponsePlan,
  completeResponseAction,
} from "../src/services/response/orchestrator";
import { EXPECTED_ACTION_TYPES, VALID_STATE_MACHINE_ARN } from "./helpers";

const INCIDENT_ID = "FF-20260920-TEST";
const T0 = "2026-09-20T10:00:00.000Z";
const EXECUTION_ARN =
  "arn:aws:states:us-east-1:124623494188:execution:FraudFirstResponseWorkflow:task10-123";
const TOKEN_KEY = `sf-token-${INCIDENT_ID}`;

const ENV: Record<string, string> = {
  AWS_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "test-key",
  AWS_SECRET_ACCESS_KEY: "test-secret",
  FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN: VALID_STATE_MACHINE_ARN,
  FRAUDFIRST_DYNAMODB_TABLE: "fraudfirst-incidents",
};

interface CommandCapture {
  commandName: string;
  params: Record<string, unknown>;
}

const store = new Map<string, Record<string, unknown>>();
const calls: CommandCapture[] = [];
let sfnSendImpl: (command: unknown) => unknown = () => ({});

function recordSfnSend(command: unknown): Promise<unknown> {
  const candidate = command as {
    constructor?: { name?: string };
    input?: Record<string, unknown>;
  };
  calls.push({
    commandName: candidate?.constructor?.name ?? "?",
    params: candidate?.input ?? {},
  });
  return Promise.resolve(sfnSendImpl(command));
}

function recordDdbSend(command: unknown): Promise<unknown> {
  const candidate = command as {
    constructor?: { name?: string };
    input?: Record<string, unknown>;
  };
  const name = candidate?.constructor?.name ?? "?";
  const params = candidate?.input ?? {};
  if (name === "GetCommand") {
    const key = (params.Key as { incidentId?: string } | undefined)?.incidentId;
    return Promise.resolve(
      key !== undefined && store.has(key) ? { Item: store.get(key) } : {}
    );
  }
  if (name === "PutCommand") {
    const item = (params.Item ?? {}) as { incidentId?: string };
    if (item.incidentId !== undefined) {
      store.set(item.incidentId, item as Record<string, unknown>);
    }
    return Promise.resolve({});
  }
  if (name === "DeleteCommand") {
    const key = (params.Key as { incidentId?: string } | undefined)?.incidentId;
    if (key !== undefined) store.delete(key);
    return Promise.resolve({});
  }
  return Promise.resolve({});
}

test.before(() => {
  mock.method(SFNClient.prototype, "send", recordSfnSend);
  mock.method(DynamoDBDocumentClient.prototype, "send", recordDdbSend);
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
});

test.after(() => {
  mock.restoreAll();
  for (const key of Object.keys(ENV)) delete process.env[key];
});

test.beforeEach(() => {
  store.clear();
  calls.length = 0;
  sfnSendImpl = () => ({});
});

function seedIncident(overrides: Record<string, unknown> = {}): void {
  store.set(INCIDENT_ID, {
    schemaVersion: 1,
    incidentId: INCIDENT_ID,
    status: "response_in_progress",
    type: "upi_fraud",
    amount: "24500",
    createdAt: T0,
    startedAt: T0,
    updatedAt: T0,
    evidence: [],
    timeline: [],
    ...overrides,
  });
}

function timelineOfType(type: string): unknown[] {
  const item = store.get(INCIDENT_ID) as { timeline?: unknown[] } | undefined;
  const events = Array.isArray(item?.timeline) ? item.timeline : [];
  return events.filter((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    return (entry as { type?: unknown }).type === type;
  });
}

function startedCommands(): CommandCapture[] {
  return calls.filter((call) => call.commandName === "StartExecutionCommand");
}

test("startIncidentResponse starts one real execution and persists a running plan without leaking tokens", async () => {
  seedIncident();
  sfnSendImpl = () => ({ executionArn: EXECUTION_ARN });

  const view = await startIncidentResponse(INCIDENT_ID);

  assert.equal(view.status, "running");
  assert.equal(view.executionStatus, "RUNNING");
  assert.equal(view.executionArn, EXECUTION_ARN);
  assert.deepEqual(
    view.actions.map((action) => action.type),
    [...EXPECTED_ACTION_TYPES]
  );

  const starts = startedCommands();
  assert.equal(starts.length, 1);
  const input = JSON.parse(starts[0].params.input as string);
  assert.equal(input.incidentId, INCIDENT_ID);
  assert.equal(input.currentAction, "preserve_evidence");

  const stored = store.get(INCIDENT_ID) as {
    response?: { executionArn?: string };
  };
  assert.equal(stored.response?.executionArn, EXECUTION_ARN);
  assert.equal(timelineOfType("response_started").length, 1);

  const serialized = JSON.stringify(view);
  assert.ok(!serialized.includes("taskToken"));
  assert.ok(!serialized.includes("TaskToken"));
  assert.ok(!serialized.includes("sf-token-"));
});

test("startIncidentResponse returns the safe status of an existing running plan without a second execution", async () => {
  seedIncident({ response: buildResponsePlan(INCIDENT_ID, T0, EXECUTION_ARN) });
  sfnSendImpl = () => ({ executionArn: "arn:second" });

  const view = await startIncidentResponse(INCIDENT_ID);

  assert.equal(view.status, "running");
  assert.equal(view.executionStatus, "RUNNING");
  assert.equal(view.executionArn, EXECUTION_ARN);
  assert.equal(view.currentActionType, "preserve_evidence");
  assert.equal(startedCommands().length, 0);
});

test("startIncidentResponse returns a completed plan's safe status without restarting", async () => {
  let plan = buildResponsePlan(INCIDENT_ID, T0, EXECUTION_ARN);
  for (const action of plan.actions) {
    const result = completeResponseAction(plan, action.id, "2026-09-20T11:00:00.000Z");
    assert.equal(result.ok, true);
    if (result.ok) plan = result.next;
  }
  seedIncident({ response: plan });

  const view = await startIncidentResponse(INCIDENT_ID);

  assert.equal(view.status, "completed");
  assert.equal(view.executionStatus, "COMPLETED");
  assert.equal(startedCommands().length, 0);
});

test("startIncidentResponse refuses without Step Functions configuration (no AWS call)", async () => {
  seedIncident();
  const savedArn = process.env.FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN;
  delete process.env.FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN;
  try {
    await assert.rejects(startIncidentResponse(INCIDENT_ID), (error: unknown) => {
      return (error as { code?: string }).code === "STEP_FUNCTIONS_NOT_CONFIGURED";
    });
  } finally {
    if (savedArn !== undefined) {
      process.env.FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN = savedArn;
    }
  }
  assert.equal(startedCommands().length, 0);
});

test("getIncidentResponse reconciles a SUCCEEDED execution to a completed plan (idempotent)", async () => {
  seedIncident({ response: buildResponsePlan(INCIDENT_ID, T0, EXECUTION_ARN) });
  sfnSendImpl = () => ({ status: "SUCCEEDED" });

  const first = await getIncidentResponse(INCIDENT_ID);
  assert.equal(first.status, "completed");
  assert.equal(first.executionStatus, "COMPLETED");
  assert.equal(first.currentActionType, null);
  assert.ok(first.actions.every((action) => action.status === "completed"));
  assert.equal(timelineOfType("response_completed").length, 1);

  const second = await getIncidentResponse(INCIDENT_ID);
  assert.equal(second.status, "completed");
  assert.equal(timelineOfType("response_completed").length, 1);
});

test("getIncidentResponse maps ABORTED to STOPPED and marks the plan failed once", async () => {
  seedIncident({ response: buildResponsePlan(INCIDENT_ID, T0, EXECUTION_ARN) });
  sfnSendImpl = () => ({ status: "ABORTED" });

  const view = await getIncidentResponse(INCIDENT_ID);
  assert.equal(view.status, "failed");
  assert.equal(view.executionStatus, "STOPPED");
  assert.equal(timelineOfType("response_failed").length, 1);

  await getIncidentResponse(INCIDENT_ID);
  assert.equal(timelineOfType("response_failed").length, 1);
});

test("getIncidentResponse maps FAILED to a failed plan", async () => {
  seedIncident({ response: buildResponsePlan(INCIDENT_ID, T0, EXECUTION_ARN) });
  sfnSendImpl = () => ({ status: "FAILED" });

  const view = await getIncidentResponse(INCIDENT_ID);
  assert.equal(view.status, "failed");
  assert.equal(view.executionStatus, "FAILED");
});

test("getIncidentResponse survives describe failures and still returns the plan safely", async () => {
  seedIncident({ response: buildResponsePlan(INCIDENT_ID, T0, EXECUTION_ARN) });
  sfnSendImpl = () => {
    const error = new Error(
      "states:DescribeExecution denied arn:aws:states:us-east-1:124623494188:execution:x"
    ) as Error & { name: string };
    error.name = "AccessDeniedException";
    throw error;
  };

  const view = await getIncidentResponse(INCIDENT_ID);
  assert.equal(view.status, "running");
  assert.equal(view.executionStatus, "RUNNING");
  assert.equal(
    calls.filter((call) => call.commandName === "DescribeExecutionCommand").length,
    1
  );
});

test("getIncidentResponse reports RESPONSE_NOT_FOUND when no plan exists", async () => {
  seedIncident();
  await assert.rejects(getIncidentResponse(INCIDENT_ID), (error: unknown) => {
    return (error as { code?: string }).code === "RESPONSE_NOT_FOUND";
  });
});

test("completeIncidentResponseAction advances the real workflow and clears the stored token", async () => {
  seedIncident({ response: buildResponsePlan(INCIDENT_ID, T0, EXECUTION_ARN) });
  store.set(TOKEN_KEY, {
    incidentId: TOKEN_KEY,
    executionArn: EXECUTION_ARN,
    actionType: "preserve_evidence",
    taskToken: "opaque-task-token-abc123",
  });
  sfnSendImpl = () => ({});

  const view = await completeIncidentResponseAction(INCIDENT_ID, "resp_preserve_evidence");

  assert.equal(view.status, "running");
  assert.equal(view.currentActionType, "contact_bank");
  assert.equal(view.actions[0].status, "completed");

  const sends = calls.filter((call) => call.commandName === "SendTaskSuccessCommand");
  assert.equal(sends.length, 1);
  assert.equal(sends[0].params.taskToken, "opaque-task-token-abc123");
  assert.equal(store.has(TOKEN_KEY), false);
  assert.equal(timelineOfType("response_action_completed").length, 1);
  assert.ok(!JSON.stringify(view).includes("taskToken"));
  assert.ok(!JSON.stringify(view).includes("TaskToken"));
});

test("completeIncidentResponseAction falls back to describe when no token is stored", async () => {
  seedIncident({ response: buildResponsePlan(INCIDENT_ID, T0, EXECUTION_ARN) });
  sfnSendImpl = () => ({ status: "RUNNING" });

  const view = await completeIncidentResponseAction(INCIDENT_ID, "resp_preserve_evidence");
  assert.equal(view.status, "running");
  assert.equal(
    calls.filter((call) => call.commandName === "DescribeExecutionCommand").length,
    1
  );
});