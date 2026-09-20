import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PersistenceServiceError,
  canonicalizeWorkspaceRecord,
} from "../src/services/incident-persistence";
import {
  buildResponsePlan,
  completeResponseAction,
} from "../src/services/response/orchestrator";
import { EXPECTED_ACTION_TYPES } from "./helpers";

const BASE = {
  schemaVersion: 1,
  incidentId: "FF-20260920-TEST",
  status: "response_in_progress",
  type: "upi_fraud",
  amount: "24500",
  createdAt: "2026-09-20T10:00:00.000Z",
  startedAt: "2026-09-20T10:00:00.000Z",
  updatedAt: "2026-09-20T10:00:00.000Z",
  evidence: [],
  timeline: [],
};

test("an incident record with the new five-action response plan canonicalizes cleanly", () => {
  const response = buildResponsePlan("FF-20260920-TEST", BASE.startedAt);
  const record = canonicalizeWorkspaceRecord({ ...BASE, response });
  assert.equal(record.incidentId, "FF-20260920-TEST");
  assert.ok(record.response, "response meta survives canonicalization");
  assert.equal(record.response!.status, "running");
  assert.deepEqual(
    record.response!.actions.map((action) => action.type),
    [...EXPECTED_ACTION_TYPES]
  );
});

test("canonicalization accepts the aligned action types in a completed plan", () => {
  let plan = buildResponsePlan("FF-20260920-TEST", BASE.startedAt);
  for (const action of plan.actions) {
    const result = completeResponseAction(plan, action.id, "2026-09-20T12:00:00.000Z");
    assert.equal(result.ok, true);
    if (result.ok) plan = result.next;
  }
  const record = canonicalizeWorkspaceRecord({ ...BASE, response: plan });
  assert.equal(record.response!.status, "completed");
  assert.equal(record.response!.currentActionType, null);
});

test("legacy action types (call_1930, report_online) are rejected by canonicalization", () => {
  const response = buildResponsePlan("FF-20260920-TEST", BASE.startedAt);
  const stale = {
    ...response,
    actions: response.actions.map((action) =>
      action.type === "contact_1930"
        ? { ...action, type: "call_1930" }
        : action.type === "report_cybercrime"
          ? { ...action, type: "report_online" }
          : action
    ),
  };
  assert.throws(
    () => canonicalizeWorkspaceRecord({ ...BASE, response: stale }),
    (error: unknown) => {
      assert.ok(error instanceof PersistenceServiceError);
      assert.equal(error.code, "INVALID_REQUEST");
      return true;
    }
  );
});

test("canonicalization rejects a response with an invalid status or too many actions", () => {
  const response = buildResponsePlan("FF-20260920-TEST", BASE.startedAt);
  assert.throws(
    () =>
      canonicalizeWorkspaceRecord({
        ...BASE,
        response: { ...response, status: "waiting" },
      }),
    (error: unknown) => error instanceof PersistenceServiceError
  );

  const duplicate = { ...response, actions: [...response.actions, response.actions[0]] };
  assert.throws(
    () =>
      canonicalizeWorkspaceRecord({
        ...BASE,
        response: duplicate,
      }),
    (error: unknown) => error instanceof PersistenceServiceError
  );
});