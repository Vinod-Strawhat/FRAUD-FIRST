import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESPONSE_ACTION_SEQUENCE,
  RESPONSE_ACTION_TYPES,
  isResponseActionType,
  responseActionDefinition,
} from "../src/services/response/sequence";
import { EXPECTED_ACTION_TYPES } from "./helpers";

test("the five response action types are exactly the required taxonomy, in order", () => {
  assert.deepEqual(RESPONSE_ACTION_TYPES, [...EXPECTED_ACTION_TYPES]);
  assert.equal(new Set(RESPONSE_ACTION_TYPES).size, 5);
});

test("the sequence defines exactly five ordered human actions", () => {
  assert.equal(RESPONSE_ACTION_SEQUENCE.length, 5);
  assert.deepEqual(
    RESPONSE_ACTION_SEQUENCE.map((definition) => definition.type),
    [...EXPECTED_ACTION_TYPES]
  );
  for (const definition of RESPONSE_ACTION_SEQUENCE) {
    assert.ok(definition.title.length > 0);
    assert.ok(definition.description.length > 0);
    assert.ok(["critical", "high", "normal"].includes(definition.priority));
    assert.ok(definition.guidance.length > 0);
  }
});

test("action titles match the Task 9A taxonomy", () => {
  const titles = Object.fromEntries(
    RESPONSE_ACTION_SEQUENCE.map((definition) => [
      definition.type,
      definition.title,
    ])
  );
  assert.equal(titles.contact_1930, "Contact 1930");
  assert.equal(titles.report_cybercrime, "Report cybercrime");
  assert.equal(titles.preserve_evidence, "Preserve evidence");
  assert.equal(titles.contact_bank, "Contact the bank or payment provider");
  assert.equal(titles.follow_up, "Follow up");
});

test("isResponseActionType accepts every supported type", () => {
  for (const type of RESPONSE_ACTION_TYPES) {
    assert.equal(isResponseActionType(type), true);
  }
});

test("isResponseActionType rejects stale legacy names and garbage", () => {
  assert.equal(isResponseActionType("call_1930"), false);
  assert.equal(isResponseActionType("report_online"), false);
  assert.equal(isResponseActionType("anything_else"), false);
  assert.equal(isResponseActionType(null), false);
  assert.equal(isResponseActionType(42), false);
});

test("responseActionDefinition resolves each supported action", () => {
  for (const type of RESPONSE_ACTION_TYPES) {
    const definition = responseActionDefinition(type);
    assert.equal(definition.type, type);
  }
});

test("responseActionDefinition rejects unknown action types", () => {
  assert.throws(
    () => responseActionDefinition("call_1930" as never),
    /Unknown response action type/
  );
});