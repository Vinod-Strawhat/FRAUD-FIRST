import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { SFNClient } from "@aws-sdk/client-sfn";
import * as sf from "../src/services/server/step-functions";
import { StepFunctionsServiceError } from "../src/services/server/step-functions";
import { VALID_STATE_MACHINE_ARN } from "./helpers";

const CONFIG = {
  AWS_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "test-key",
  AWS_SECRET_ACCESS_KEY: "test-secret",
  FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN: VALID_STATE_MACHINE_ARN,
};

interface CommandCapture {
  commandName: string;
  params: Record<string, unknown>;
}

const calls: CommandCapture[] = [];
let sendImpl: (command: unknown) => unknown = () => ({});

function recordSend(command: unknown): Promise<unknown> {
  const candidate = command as {
    constructor?: { name?: string };
    input?: Record<string, unknown>;
    params?: Record<string, unknown>;
  };
  const commandName =
    candidate?.constructor?.name ??
    (candidate as { commandName?: string }).commandName ??
    "?";
  const params = candidate?.input ?? candidate?.params ?? {};
  calls.push({ commandName, params });
  return Promise.resolve(sendImpl(command));
}

test.before(() => {
  mock.method(SFNClient.prototype, "send", recordSend);
  for (const [key, value] of Object.entries(CONFIG)) {
    process.env[key] = value;
  }
});

test.after(() => {
  mock.restoreAll();
  for (const key of Object.keys(CONFIG)) delete process.env[key];
});

function fakeAwsError(name: string, message: string): Error {
  const error = new Error(message) as Error & { name: string };
  error.name = name;
  return error;
}

const safeInput = {
  incidentId: "FF-20260920-TEST",
  startedAt: "2026-09-20T10:00:00.000Z",
  currentAction: "preserve_evidence" as const,
  amount: "24500",
  currency: "INR" as const,
};

test("startResponseExecution returns the execution ARN and sends only safe metadata", async () => {
  calls.length = 0;
  sendImpl = () => ({ executionArn: "arn:aws:states:us-east-1:124623494188:execution:rof:i-1" });

  const executionArn = await sf.startResponseExecution(safeInput);
  assert.equal(
    executionArn,
    "arn:aws:states:us-east-1:124623494188:execution:rof:i-1"
  );

  const start = calls.find((call) => call.commandName === "StartExecutionCommand");
  assert.ok(start, "StartExecution command was sent");
  assert.equal(start!.params.stateMachineArn, VALID_STATE_MACHINE_ARN);
  const sentInput = JSON.parse(start!.params.input as string);
  assert.deepEqual(sentInput, safeInput);
  assert.deepEqual(Object.keys(sentInput).sort(), [
    "amount",
    "currency",
    "currentAction",
    "incidentId",
    "startedAt",
  ]);
  const serialized = JSON.stringify(sentInput);
  assert.ok(!serialized.includes("taskToken"));
  assert.ok(!serialized.includes("TaskToken"));
  assert.ok(!serialized.includes("secret"));
});

test("describeResponseExecution returns the status from AWS", async () => {
  calls.length = 0;
  sendImpl = () => ({ status: "RUNNING", executionArn: "arn:exec" });
  const result = await sf.describeResponseExecution(
    "arn:aws:states:us-east-1:124623494188:execution:rof:i-1"
  );
  assert.deepEqual(result, { status: "RUNNING" });
  assert.equal(calls[0].commandName, "DescribeExecutionCommand");
});

test("sendTaskSuccess forwards the opaque task token and serialized output", async () => {
  calls.length = 0;
  sendImpl = () => ({});
  await sf.sendTaskSuccess("opaque-token-abc123", {
    incidentId: "FF-20260920-TEST",
    actionType: "contact_1930",
  });
  const send = calls.find((call) => call.commandName === "SendTaskSuccessCommand");
  assert.ok(send);
  assert.equal(send!.params.taskToken, "opaque-token-abc123");
  assert.deepEqual(JSON.parse(send!.params.output as string), {
    incidentId: "FF-20260920-TEST",
    actionType: "contact_1930",
  });
});

test("sendTaskFailure forwards the token with an opaque error/cause", async () => {
  calls.length = 0;
  sendImpl = () => ({});
  await sf.sendTaskFailure("opaque-token-abc123", {
    error: "UserClosedIncident",
    cause: "The incident was closed by the user.",
  });
  const send = calls.find((call) => call.commandName === "SendTaskFailureCommand");
  assert.ok(send);
  assert.equal(send!.params.taskToken, "opaque-token-abc123");
  assert.equal(send!.params.error, "UserClosedIncident");
});

test("startResponseExecution rejects cleanly when AWS returns no execution ARN", async () => {
  sendImpl = () => ({});
  await assert.rejects(sf.startResponseExecution(safeInput), (error: unknown) => {
    assert.ok(error instanceof StepFunctionsServiceError);
    assert.equal(error.code, "STEP_FUNCTIONS_REQUEST_FAILED");
    assert.equal(
      error.safeMessage,
      "The response workflow did not return an execution reference."
    );
    return true;
  });
});

const EXPECTED_MAPPINGS: Array<[string, string]> = [
  ["AccessDeniedException", "The response workflow access was denied for this environment."],
  ["ExecutionAlreadyExists", "A response workflow is already running for this incident."],
  ["StateMachineDoesNotExist", "The configured response workflow does not exist."],
  ["InvalidArn", "The response workflow configuration is invalid."],
  ["ValidationException", "The response workflow configuration is invalid."],
  ["ThrottlingException", "The response workflow service is busy. Try again in a moment."],
  ["InvalidToken", "The response workflow task is no longer valid to advance."],
  ["TaskDoesNotExist", "The response workflow task is no longer valid to advance."],
  ["TaskTimedOut", "The response workflow task timed out before it could be advanced."],
];

test("StartExecution failures map to fixed safe messages without leaking AWS internals", async () => {
  for (const [name, expectedMessage] of EXPECTED_MAPPINGS) {
    sendImpl = () => {
      throw fakeAwsError(
        name,
        `raw AWS detail: arn:aws:iam::124623494188:user/fraudfirst-dev requestId deadbeef ${name}`
      );
    };
    await assert.rejects(sf.startResponseExecution(safeInput), (error: unknown) => {
      assert.ok(error instanceof StepFunctionsServiceError, `${name} -> StepFunctionsServiceError`);
      assert.equal(error.code, "STEP_FUNCTIONS_REQUEST_FAILED");
      assert.equal(error.safeMessage, expectedMessage);
      assert.ok(!error.safeMessage.includes("arn:aws"));
      assert.ok(!error.safeMessage.includes("fraudfirst-dev"));
      assert.ok(!error.safeMessage.includes("deadbeef"));
      assert.ok(!error.safeMessage.includes("requestId"));
      return true;
    });
  }
});

test("DescribeExecution failures are sanitized", async () => {
  sendImpl = () => {
    throw fakeAwsError("AccessDeniedException", "states:DescribeExecution denied arn:aws:states:us-east-1:x");
  };
  await assert.rejects(
    sf.describeResponseExecution("arn:aws:states:us-east-1:124623494188:execution:rof:i-1"),
    (error: unknown) => {
      assert.ok(error instanceof StepFunctionsServiceError);
      assert.equal(error.safeMessage, "The response workflow access was denied for this environment.");
      return true;
    }
  );
});

test("SendTaskSuccess failures are sanitized", async () => {
  sendImpl = () => {
    throw fakeAwsError(
      "InvalidToken",
      "token arn:aws:states:us-east-1:124623494188:execution:rof:i-1 failed; no retries"
    );
  };
  await assert.rejects(
    sf.sendTaskSuccess("opaque-token-1", { incidentId: "FF-20260920-TEST" }),
    (error: unknown) => {
      assert.ok(error instanceof StepFunctionsServiceError);
      assert.equal(error.code, "STEP_FUNCTIONS_REQUEST_FAILED");
      assert.equal(
        error.safeMessage,
        "The response workflow task is no longer valid to advance."
      );
      return true;
    }
  );
});

test("SendTaskFailure failures are sanitized", async () => {
  sendImpl = () => {
    throw fakeAwsError(
      "AccessDeniedException",
      "User: arn:aws:iam::124623494188:user/fraudfirst-dev is not authorized to perform: states:SendTaskFailure"
    );
  };
  await assert.rejects(sf.sendTaskFailure("opaque-token-1"), (error: unknown) => {
    assert.ok(error instanceof StepFunctionsServiceError);
    assert.equal(error.code, "STEP_FUNCTIONS_REQUEST_FAILED");
    assert.equal(
      error.safeMessage,
      "The response workflow access was denied for this environment."
    );
    return true;
  });
});

test("unknown failures degrade to the generic sentence with no exception text leaked", async () => {
  sendImpl = () => {
    throw new Error("boom module internals arn:aws:iam::124623494188 + MY_SECRET_VALUE");
  };
  await assert.rejects(sf.startResponseExecution(safeInput), (error: unknown) => {
    assert.ok(error instanceof StepFunctionsServiceError);
    assert.equal(
      error.safeMessage,
      "The response workflow could not be orchestrated. Please try again."
    );
    assert.ok(!error.safeMessage.includes("boom"));
    assert.ok(!error.safeMessage.includes("MY_SECRET_VALUE"));
    assert.ok(!error.safeMessage.includes("arn:aws"));
    return true;
  });
});