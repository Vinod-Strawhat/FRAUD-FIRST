import {
  DescribeExecutionCommand,
  SendTaskFailureCommand,
  SendTaskSuccessCommand,
  SFNClient,
  StartExecutionCommand,
} from "@aws-sdk/client-sfn";
import type { ResponseActionType } from "@/types";

export type StepFunctionsErrorCode =
  | "STEP_FUNCTIONS_NOT_CONFIGURED"
  | "STEP_FUNCTIONS_REQUEST_FAILED";

export class StepFunctionsServiceError extends Error {
  readonly code: StepFunctionsErrorCode;
  readonly safeMessage: string;

  constructor(code: StepFunctionsErrorCode, message: string) {
    super(message);
    this.name = "StepFunctionsServiceError";
    this.code = code;
    this.safeMessage = message;
  }
}

export interface ResponseExecutionInput {
  incidentId: string;
  startedAt: string;
  currentAction: ResponseActionType | null;
  amount: string | null;
  currency: "INR";
}

const STATE_MACHINE_ARN_RE =
  /^arn:aws:states:[a-z0-9-]+:\d{12}:stateMachine:[A-Za-z0-9_-]+$/;

let sfnClient: SFNClient | null = null;

function createSfnClient(): SFNClient {
  return new SFNClient({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
  });
}

function sfnClientOrThrow(): SFNClient {
  if (!sfnClient) {
    sfnClient = createSfnClient();
  }
  return sfnClient;
}

export function configuredStateMachineArn(): string | null {
  const arn = process.env.FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN;
  if (typeof arn !== "string" || arn.trim().length === 0) return null;
  const value = arn.trim();
  return STATE_MACHINE_ARN_RE.test(value) ? value : null;
}

export function hasStepFunctionsConfiguration(): boolean {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const hasRegion = Boolean(region);
  const hasStaticCredentials =
    Boolean(process.env.AWS_ACCESS_KEY_ID) &&
    Boolean(process.env.AWS_SECRET_ACCESS_KEY);
  const hasProfile = Boolean(process.env.AWS_PROFILE);
  return Boolean(configuredStateMachineArn()) && hasRegion && (hasStaticCredentials || hasProfile);
}

function mapStepFunctionsFailure(error: unknown): never {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? (error as { name?: string }).name
      : undefined;

  let message = "The response workflow could not be orchestrated. Please try again.";
  switch (name) {
    case "AccessDeniedException":
      message = "The response workflow access was denied for this environment.";
      break;
    case "ExecutionAlreadyExists":
      message = "A response workflow is already running for this incident.";
      break;
    case "StateMachineDoesNotExist":
      message = "The configured response workflow does not exist.";
      break;
    case "InvalidArn":
    case "ValidationException":
      message = "The response workflow configuration is invalid.";
      break;
    case "ThrottlingException":
      message = "The response workflow service is busy. Try again in a moment.";
      break;
    case "InvalidToken":
    case "TaskDoesNotExist":
      message = "The response workflow task is no longer valid to advance.";
      break;
    case "TaskTimedOut":
      message = "The response workflow task timed out before it could be advanced.";
      break;
    default:
      break;
  }
  throw new StepFunctionsServiceError("STEP_FUNCTIONS_REQUEST_FAILED", message);
}

export async function startResponseExecution(
  input: ResponseExecutionInput
): Promise<string> {
  if (!hasStepFunctionsConfiguration()) {
    throw new StepFunctionsServiceError(
      "STEP_FUNCTIONS_NOT_CONFIGURED",
      "Step Functions is not configured for this environment."
    );
  }
  const stateMachineArn = configuredStateMachineArn() as string;
  try {
    const response = await sfnClientOrThrow().send(
      new StartExecutionCommand({
        stateMachineArn,
        input: JSON.stringify(input),
      })
    );
    if (!response.executionArn) {
      throw new StepFunctionsServiceError(
        "STEP_FUNCTIONS_REQUEST_FAILED",
        "The response workflow did not return an execution reference."
      );
    }
    return response.executionArn;
  } catch (error) {
    if (error instanceof StepFunctionsServiceError) {
      throw error;
    }
    mapStepFunctionsFailure(error);
  }
}

export async function describeResponseExecution(
  executionArn: string
): Promise<{ status: string }> {
  try {
    const response = await sfnClientOrThrow().send(
      new DescribeExecutionCommand({ executionArn })
    );
    return { status: response.status ?? "UNKNOWN" };
  } catch (error) {
    mapStepFunctionsFailure(error);
  }
}

export async function sendTaskSuccess(
  taskToken: string,
  output: unknown
): Promise<void> {
  try {
    await sfnClientOrThrow().send(
      new SendTaskSuccessCommand({
        taskToken,
        output: JSON.stringify(output),
      })
    );
  } catch (error) {
    mapStepFunctionsFailure(error);
  }
}

export interface SendTaskFailureDetails {
  error?: string;
  cause?: string;
}

export async function sendTaskFailure(
  taskToken: string,
  details: SendTaskFailureDetails = {}
): Promise<void> {
  try {
    await sfnClientOrThrow().send(
      new SendTaskFailureCommand({
        taskToken,
        error: details.error,
        cause: details.cause,
      })
    );
  } catch (error) {
    mapStepFunctionsFailure(error);
  }
}

export async function listAccessibleStateMachines(): Promise<string[]> {
  const { ListStateMachinesCommand } = await import(
    "@aws-sdk/client-sfn"
  );
  try {
    const response = await sfnClientOrThrow().send(new ListStateMachinesCommand({}));
    return (response.stateMachines ?? []).map((machine) => machine.name ?? "");
  } catch (error) {
    mapStepFunctionsFailure(error);
  }
}