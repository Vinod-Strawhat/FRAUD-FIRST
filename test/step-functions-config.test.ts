import { test } from "node:test";
import assert from "node:assert/strict";
import {
  StepFunctionsServiceError,
  configuredStateMachineArn,
  hasStepFunctionsConfiguration,
  startResponseExecution,
} from "../src/services/server/step-functions";
import {
  VALID_STATE_MACHINE_ARN,
  restoreStepFunctionsEnv,
  setStepFunctionsEnv,
} from "./helpers";

test.after(restoreStepFunctionsEnv);

test("configuredStateMachineArn returns null when unset or empty", () => {
  setStepFunctionsEnv({ FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN: undefined });
  assert.equal(configuredStateMachineArn(), null);
  setStepFunctionsEnv({ FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN: "" });
  assert.equal(configuredStateMachineArn(), null);
  setStepFunctionsEnv({ FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN: "   " });
  assert.equal(configuredStateMachineArn(), null);
});

test("configuredStateMachineArn validates a real state machine ARN shape", () => {
  setStepFunctionsEnv({
    FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN: `  ${VALID_STATE_MACHINE_ARN}  `,
  });
  assert.equal(configuredStateMachineArn(), VALID_STATE_MACHINE_ARN);
});

test("configuredStateMachineArn rejects malformed ARNs", () => {
  const invalid = [
    "arn:aws:states:us-east-1:123:stateMachine:FraudFirstResponseWorkflow",
    "arn:aws:states:us-east-1:124623494188:activity:FraudFirstResponseWorkflow",
    "arn:aws:lambda:us-east-1:124623494188:function:FraudFirstResponseBridge",
    "not-an-arn",
    "arn:aws:states:us-east-1:124623494188:stateMachine:",
  ];
  for (const value of invalid) {
    setStepFunctionsEnv({
      FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN: value,
    });
    assert.equal(configuredStateMachineArn(), null, `expected null for: ${value}`);
  }
});

test("hasStepFunctionsConfiguration requires ARN, region and credentials", () => {
  const full = {
    FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN: VALID_STATE_MACHINE_ARN,
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "key",
    AWS_SECRET_ACCESS_KEY: "secret",
  };

  setStepFunctionsEnv({});
  assert.equal(hasStepFunctionsConfiguration(), false);

  setStepFunctionsEnv({ ...full, FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN: "" });
  assert.equal(hasStepFunctionsConfiguration(), false, "missing ARN");

  setStepFunctionsEnv({ ...full, AWS_REGION: "" });
  assert.equal(hasStepFunctionsConfiguration(), false, "missing region");

  setStepFunctionsEnv({ ...full, AWS_SECRET_ACCESS_KEY: undefined });
  assert.equal(hasStepFunctionsConfiguration(), false, "missing credentials");

  setStepFunctionsEnv({
    ...full,
    AWS_ACCESS_KEY_ID: undefined,
    AWS_PROFILE: "fraudfirst-dev",
  });
  assert.equal(hasStepFunctionsConfiguration(), true, "works with a profile");

  setStepFunctionsEnv(full);
  assert.equal(hasStepFunctionsConfiguration(), true);
});

test("startResponseExecution throws STEP_FUNCTIONS_NOT_CONFIGURED when unconfigured", async () => {
  setStepFunctionsEnv({});
  await assert.rejects(
    startResponseExecution({
      incidentId: "FF-20260920-TEST",
      startedAt: "2026-09-20T10:00:00.000Z",
      currentAction: "preserve_evidence",
      amount: null,
      currency: "INR",
    }),
    (error: unknown) => {
      assert.ok(error instanceof StepFunctionsServiceError);
      assert.equal(error.code, "STEP_FUNCTIONS_NOT_CONFIGURED");
      assert.equal(
        error.safeMessage,
        "Step Functions is not configured for this environment."
      );
      return true;
    }
  );
});

test("startResponseExecution refuses immediately when the ARN env is missing (no AWS call)", async () => {
  setStepFunctionsEnv({
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "key",
    AWS_SECRET_ACCESS_KEY: "secret",
    FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN: "",
  });
  await assert.rejects(startResponseExecution({
    incidentId: "FF-20260920-TEST",
    startedAt: "2026-09-20T10:00:00.000Z",
    currentAction: "contact_bank",
    amount: "24500",
    currency: "INR",
  }), (error: unknown) => {
    assert.ok(error instanceof StepFunctionsServiceError);
    assert.equal(error.code, "STEP_FUNCTIONS_NOT_CONFIGURED");
    return true;
  });
});