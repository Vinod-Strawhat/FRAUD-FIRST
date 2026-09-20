export const VALID_STATE_MACHINE_ARN =
  "arn:aws:states:us-east-1:124623494188:stateMachine:FraudFirstResponseWorkflow";

export const EXPECTED_ACTION_TYPES = [
  "preserve_evidence",
  "contact_bank",
  "contact_1930",
  "report_cybercrime",
  "follow_up",
] as const;

const KEPT_ENV_KEYS = [
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_PROFILE",
  "FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN",
] as const;

const savedEnv = new Map<string, string | undefined>(
  KEPT_ENV_KEYS.map((key) => [key, process.env[key]])
);

export function setStepFunctionsEnv(
  values: Record<string, string | undefined>
): void {
  for (const key of KEPT_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

export function restoreStepFunctionsEnv(): void {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}