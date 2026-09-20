import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import type { IncidentWorkspaceRecord } from "@/types";

export class DynamoDbServiceError extends Error {
  readonly code: "DYNAMODB_NOT_CONFIGURED" | "DYNAMODB_REQUEST_FAILED";
  readonly safeMessage: string;

  constructor(
    code: "DYNAMODB_NOT_CONFIGURED" | "DYNAMODB_REQUEST_FAILED",
    message: string
  ) {
    super(message);
    this.name = "DynamoDbServiceError";
    this.code = code;
    this.safeMessage = message;
  }
}

export class DynamoDbConflictError extends Error {
  constructor() {
    super("Concurrent update conflict.");
    this.name = "DynamoDbConflictError";
  }
}

let documentClient: DynamoDBDocumentClient | null = null;

function createDocumentClient(): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
  });
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertClassInstanceToMap: true,
    },
    unmarshallOptions: {
      wrapNumbers: false,
    },
  });
}

function documentClientOrThrow(): DynamoDBDocumentClient {
  if (!documentClient) {
    documentClient = createDocumentClient();
  }
  return documentClient;
}

export function configuredIncidentTable(): string | null {
  const table = process.env.FRAUDFIRST_DYNAMODB_TABLE;
  return typeof table === "string" && table.trim().length > 0
    ? table.trim()
    : null;
}

export function hasPersistenceConfiguration(): boolean {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const hasRegion = Boolean(region);
  const hasStaticCredentials =
    Boolean(process.env.AWS_ACCESS_KEY_ID) &&
    Boolean(process.env.AWS_SECRET_ACCESS_KEY);
  const hasProfile = Boolean(process.env.AWS_PROFILE);
  return hasRegion && (hasStaticCredentials || hasProfile) && Boolean(configuredIncidentTable());
}

function requireTable(): string {
  const table = configuredIncidentTable();
  if (!table) {
    throw new DynamoDbServiceError(
      "DYNAMODB_NOT_CONFIGURED",
      "Incident persistence is not configured for this environment."
    );
  }
  return table;
}

function mapDynamoDbFailure(error: unknown): never {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? (error as { name?: string }).name
      : undefined;
  if (name === "ConditionalCheckFailedException") {
    throw new DynamoDbConflictError();
  }
  throw new DynamoDbServiceError(
    "DYNAMODB_REQUEST_FAILED",
    "The incident store could not be reached. Please try again."
  );
}

export async function readIncidentRecord(
  incidentId: string
): Promise<IncidentWorkspaceRecord | null> {
  const table = requireTable();
  try {
    const response = await documentClientOrThrow().send(
      new GetCommand({ TableName: table, Key: { incidentId } })
    );
    return (response.Item as IncidentWorkspaceRecord | undefined) ?? null;
  } catch (error) {
    mapDynamoDbFailure(error);
  }
}

export async function writeIncidentRecord(
  record: IncidentWorkspaceRecord,
  expectedUpdatedAt?: string
): Promise<void> {
  const table = requireTable();
  const command: PutCommand = new PutCommand({
    TableName: table,
    Item: record,
    ...(expectedUpdatedAt
      ? {
          ConditionExpression: "updatedAt = :expected",
          ExpressionAttributeValues: { ":expected": expectedUpdatedAt },
        }
      : {}),
  });
  try {
    await documentClientOrThrow().send(command);
  } catch (error) {
    mapDynamoDbFailure(error);
  }
}

export async function deleteIncidentRecord(incidentId: string): Promise<void> {
  const table = requireTable();
  try {
    await documentClientOrThrow().send(
      new DeleteCommand({ TableName: table, Key: { incidentId } })
    );
  } catch (error) {
    mapDynamoDbFailure(error);
  }
}

const RESPONSE_TOKEN_PREFIX = "sf-token-";

export interface ResponseTaskTokenReference {
  incidentId: string;
  executionArn: string;
  actionType: string;
  taskToken: string;
}

export async function readResponseTaskToken(
  incidentId: string
): Promise<ResponseTaskTokenReference | null> {
  const table = requireTable();
  try {
    const response = await documentClientOrThrow().send(
      new GetCommand({
        TableName: table,
        Key: { incidentId: `${RESPONSE_TOKEN_PREFIX}${incidentId}` },
      })
    );
    const item = response.Item as Partial<ResponseTaskTokenReference> | undefined;
    if (!item || typeof item.taskToken !== "string") return null;
    return {
      incidentId,
      executionArn: typeof item.executionArn === "string" ? item.executionArn : "",
      actionType: typeof item.actionType === "string" ? item.actionType : "",
      taskToken: item.taskToken,
    };
  } catch (error) {
    mapDynamoDbFailure(error);
  }
}

export async function clearResponseTaskToken(incidentId: string): Promise<void> {
  const table = requireTable();
  try {
    await documentClientOrThrow().send(
      new DeleteCommand({
        TableName: table,
        Key: { incidentId: `${RESPONSE_TOKEN_PREFIX}${incidentId}` },
      })
    );
  } catch (error) {
    mapDynamoDbFailure(error);
  }
}