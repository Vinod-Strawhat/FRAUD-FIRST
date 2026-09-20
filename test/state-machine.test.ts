import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { EXPECTED_ACTION_TYPES } from "./helpers";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const aslPath = path.join(
  repoRoot,
  "aws",
  "response-workflow",
  "state-machine.json"
);

interface TaskState {
  Type: "Task";
  Resource: string;
  Parameters: {
    FunctionName?: string;
    Payload?: Record<string, unknown>;
  };
  ResultPath?: unknown;
  TimeoutSeconds?: number;
  Next?: string;
  Comment?: string;
}

type Asl = {
  Comment: string;
  StartAt: string;
  States: Record<
    string,
    TaskState | { Type: "Pass" | "Fail"; Next?: string; End?: boolean }
  >;
};

const asl = JSON.parse(readFileSync(aslPath, "utf8")) as Asl;

const WAIT_FOR_TASK_TOKEN_RESOURCE = "arn:aws:states:::lambda:invoke.waitForTaskToken";
const BRIDGE_FUNCTION_NAME = "FraudFirstResponseBridge";
const HUMAN_WAIT_TIMEOUT_SECONDS = 1209600;

function taskStates(): [string, TaskState][] {
  const entries = Object.entries(asl.States).filter(
    (entry): entry is [string, TaskState] => entry[1].Type === "Task"
  );
  return entries;
}

function followingSequence(): string[] {
  const order: string[] = [];
  let current = asl.StartAt;
  const guard = new Set<string>();
  while (current && !guard.has(current)) {
    guard.add(current);
    const state = asl.States[current];
    if (!state) break;
    order.push(current);
    if ("Next" in state && typeof state.Next === "string") {
      current = state.Next;
    } else {
      break;
    }
  }
  return order;
}

test("state machine entry point is the INCIDENT_STARTED Pass boundary", () => {
  assert.equal(asl.StartAt, "INCIDENT_STARTED");
  const start = asl.States.INCIDENT_STARTED;
  assert.equal(start.Type, "Pass");
  assert.equal(start.Next, "PRESERVE_EVIDENCE");
});

test("exactly five Task states exist", () => {
  assert.equal(taskStates().length, 5);
});

test("every task uses arn:aws:states:::lambda:invoke.waitForTaskToken", () => {
  for (const [, state] of taskStates()) {
    assert.equal(state.Resource, WAIT_FOR_TASK_TOKEN_RESOURCE);
    assert.equal(state.Type, "Task");
  }
});

test("each task invokes FraudFirstResponseBridge with a safe metadata payload", () => {
  for (const [, state] of taskStates()) {
    assert.equal(state.Parameters.FunctionName, BRIDGE_FUNCTION_NAME);
    const payload = state.Parameters.Payload ?? {};
    assert.equal(payload["incidentId.$"], "$.incidentId");
    assert.ok(
      (EXPECTED_ACTION_TYPES as readonly string[]).includes(
        payload.actionType as string
      ),
      `unexpected actionType: ${String(payload.actionType)}`
    );
  }
});

test("all five required action types reach the bridge in the documented sequence", () => {
  const order = followingSequence();
  const taskNames = order.filter(
    (name) => asl.States[name].Type === "Task"
  );
  assert.equal(taskNames.length, 5);
  const actionTypes = taskNames.map(
    (name) => (asl.States[name] as TaskState).Parameters.Payload?.actionType
  );
  assert.deepEqual(actionTypes, [...EXPECTED_ACTION_TYPES]);
});

test("TaskToken is wired to the Step Functions task token intrinsic", () => {
  for (const [, state] of taskStates()) {
    const payload = state.Parameters.Payload ?? {};
    assert.equal(payload["TaskToken.$"], "$$.Task.Token");
  }
});

test("every task discards the Lambda result with ResultPath null", () => {
  for (const [, state] of taskStates()) {
    assert.equal(state.ResultPath, null);
  }
});

test("every human-action task waits 14 days (128) without auto-completion", () => {
  for (const [, state] of taskStates()) {
    assert.equal(state.TimeoutSeconds, HUMAN_WAIT_TIMEOUT_SECONDS);
  }
});

test("fixed sequence: preserve -> bank -> 1930 -> cybercrime report -> follow up -> complete", () => {
  assert.deepEqual(followingSequence(), [
    "INCIDENT_STARTED",
    "PRESERVE_EVIDENCE",
    "CONTACT_BANK",
    "CONTACT_1930",
    "REPORT_CYBERCRIME",
    "FOLLOW_UP",
    "RESPONSE_COMPLETE",
  ]);
  const complete = asl.States.RESPONSE_COMPLETE;
  assert.equal(complete.Type, "Pass");
  assert.equal(complete.End, true);
});

test("no unreachable FAILED terminal state (AWS rejects unreachable Fail states at create)", () => {
  assert.equal(asl.States.FAILED, undefined, "FAILED was removed because Step Functions rejects an unreachable Fail state with MISSING_TRANSITION_TARGET at CreateStateMachine");
  const complete = asl.States.RESPONSE_COMPLETE;
  assert.equal(complete.Type, "Pass");
  if (complete.Type === "Pass") {
    assert.equal(complete.End, true, "the workflow's only terminal state is RESPONSE_COMPLETE");
  }
});

test("the machine references no AWS resources other than the bridge integration", () => {
  const arns = JSON.stringify(asl).match(/arn:aws:[^"]+/g) ?? [];
  assert.ok(arns.length > 0, "expected at least the waitForTaskToken resource");
  for (const arn of arns) {
    assert.equal(arn, WAIT_FOR_TASK_TOKEN_RESOURCE);
  }
});

test("workflow input reads only incidentId, so it permissively accepts {incidentId, actionType}", () => {
  const dataReferences = new Set<string>();
  for (const match of JSON.stringify(asl).matchAll(/"\$\.([A-Za-z]+)"/g)) {
    dataReferences.add(match[1]);
  }
  assert.deepEqual([...dataReferences], ["incidentId"]);
  const intrinsicStarts = JSON.stringify(asl).includes("$$.Task.Token");
  assert.equal(intrinsicStarts, true);
  const bridgeReference = JSON.stringify(asl).includes(BRIDGE_FUNCTION_NAME);
  assert.equal(bridgeReference, true);
});