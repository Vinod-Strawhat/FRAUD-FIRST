import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildResponseActions,
  buildResponsePlan,
  completeResponseAction,
  compactResponseActions,
  responseActionId,
  responseProgress,
} from "../src/services/response/orchestrator";
import { EXPECTED_ACTION_TYPES } from "./helpers";

const STARTED_AT = "2026-09-20T10:00:00.000Z";

test("responseActionId produces the opaque resp_<type> identifier (no TaskToken)", () => {
  assert.equal(responseActionId("preserve_evidence"), "resp_preserve_evidence");
  assert.equal(responseActionId("contact_1930"), "resp_contact_1930");
  assert.equal(responseActionId("report_cybercrime"), "resp_report_cybercrime");
});

test("buildResponsePlan creates five ordered pending actions starting at the first", () => {
  const plan = buildResponsePlan("FF-20260920-TEST", STARTED_AT);
  assert.equal(plan.status, "running");
  assert.equal(plan.currentActionType, "preserve_evidence");
  assert.equal(plan.startedAt, STARTED_AT);
  assert.equal(plan.actions.length, 5);
  assert.deepEqual(
    plan.actions.map((action) => action.type),
    [...EXPECTED_ACTION_TYPES]
  );
  assert.deepEqual(
    plan.actions.map((action) => action.order),
    [1, 2, 3, 4, 5]
  );
  for (const action of plan.actions) {
    assert.equal(action.status, "pending");
    assert.equal(action.id, `resp_${action.type}`);
    assert.equal(action.createdAt, STARTED_AT);
  }
});

test("completing the current action advances the pointer to the next one", () => {
  const plan = buildResponsePlan("FF-20260920-TEST", STARTED_AT);
  const first = plan.actions[0];
  const result = completeResponseAction(
    plan,
    first.id,
    "2026-09-20T10:15:00.000Z"
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.completedActionType, "preserve_evidence");
  assert.equal(result.next.currentActionType, "contact_bank");
  assert.equal(result.next.status, "running");
  assert.equal(result.next.actions[0].status, "completed");
  assert.equal(result.next.actions[0].completedAt, "2026-09-20T10:15:00.000Z");
  assert.equal(result.workflowCompleted, false);
});

test("completed actions cannot be re-completed (ACTION_ALREADY_COMPLETED)", () => {
  const plan = buildResponsePlan("FF-20260920-TEST", STARTED_AT);
  const completed = completeResponseAction(plan, plan.actions[0].id, "t");
  assert.equal(completed.ok, true);
  if (!completed.ok) return;
  const again = completeResponseAction(
    completed.next,
    plan.actions[0].id,
    "t2"
  );
  assert.equal(again.ok, false);
  if (again.ok) return;
  assert.equal(again.code, "ACTION_ALREADY_COMPLETED");
});

test("unknown action ids are rejected (ACTION_NOT_FOUND)", () => {
  const plan = buildResponsePlan("FF-20260920-TEST", STARTED_AT);
  const result = completeResponseAction(plan, "resp_missing", "t");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "ACTION_NOT_FOUND");
});

test("non-current actions are rejected (ACTION_NOT_CURRENT)", () => {
  const plan = buildResponsePlan("FF-20260920-TEST", STARTED_AT);
  const result = completeResponseAction(plan, plan.actions[1].id, "t");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "ACTION_NOT_CURRENT");
});

test("completing all five actions completes the workflow with no current action", () => {
  let plan = buildResponsePlan("FF-20260920-TEST", STARTED_AT);
  let last: ReturnType<typeof completeResponseAction> | null = null;
  for (const action of plan.actions) {
    last = completeResponseAction(plan, action.id, "2026-09-20T11:00:00.000Z");
    assert.equal(last.ok, true);
    if (last.ok) plan = last.next;
  }
  assert.ok(last?.ok);
  if (!last?.ok) return;
  assert.equal(last.workflowCompleted, true);
  assert.equal(last.next.status, "completed");
  assert.equal(last.next.currentActionType, null);
  assert.ok(last.next.actions.every((action) => action.status === "completed"));
});

test("responseProgress accounts completed vs remaining actions", () => {
  const plan = buildResponsePlan("FF-20260920-TEST", STARTED_AT);
  assert.deepEqual(responseProgress(plan), { completed: 0, total: 5, remaining: 5 });
  const done = completeResponseAction(plan, plan.actions[0].id, "t");
  assert.equal(done.ok, true);
  if (done.ok) {
    assert.deepEqual(responseProgress(done.next), {
      completed: 1,
      total: 5,
      remaining: 4,
    });
  }
});

test("compactResponseActions persists only whitelisted metadata (no TaskToken)", () => {
  const actions = buildResponseActions("FF-20260920-TEST", STARTED_AT);
  const compacted = compactResponseActions(actions);
  for (const entry of compacted) {
    const keys = Object.keys(entry).sort();
    assert.deepEqual(keys, [
      "completedAt",
      "createdAt",
      "id",
      "order",
      "status",
      "type",
    ]);
  }
  assert.ok(!JSON.stringify(compacted).toLowerCase().includes("token"));
});