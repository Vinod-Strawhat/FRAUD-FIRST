/**
 * FraudFirstResponseBridge — deployment reference for the Step Functions
 * waitForTaskToken integration (Task 8).
 *
 * This Lambda is the ONLY glue between the state machine and the app's
 * authoritative DynamoDB record so the app can send the task token back on
 * explicit user completion. It contains no secrets, reads no evidence, and
 * only writes the task token (a callback credential) to a scoped token item
 * in the SAME single incident table used by the app.
 *
 * Required Lambda IAM permissions (minimal):
 *   dynamodb:PutItem   on the incident table ONLY for keys under the
 *                      "sf-token-" prefix.
 *
 * Deployment (non-exhaustive reference):
 *   aws lambda create-function --function-name FraudFirstResponseBridge \
 *     --runtime nodejs22.x --role arn:aws:iam::ACCOUNT_ID:role/FraudFirstResponseBridgeRole \
 *     --handler index.handler --zip-file fileb://bridge.zip --timeout 30
 *   Set env FRAUDFIRST_DYNAMODB_TABLE=fraudfirst-incidents on the function.
 *   Grant states:StartExecution / states:DescribeExecution /
 *     states:SendTaskSuccess on the state machine to the app's IAM role.
 *
 * Not part of the Next.js runtime bundle.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const RESPONSE_TOKEN_PREFIX = "sf-token-";

export async function handler(event) {
  const entryType = event?.actionType ? String(event.actionType) : undefined;
  const incidentId = event?.incidentId ? String(event.incidentId) : undefined;
  const taskToken = event?.TaskToken ? String(event.TaskToken) : undefined;

  if (!incidentId || !taskToken) {
    throw new Error("Missing incidentId or TaskToken in the state payload.");
  }

  const executionArn = (event?.executionArn || "").toString();

  const table = process.env.FRAUDFIRST_DYNAMODB_TABLE;
  if (!table) {
    throw new Error("FRAUDFIRST_DYNAMODB_TABLE is not configured.");
  }

  await client.send(
    new PutCommand({
      TableName: table,
      Item: {
        incidentId: `${RESPONSE_TOKEN_PREFIX}${incidentId}`,
        executionArn,
        actionType: entryType || "",
        taskToken,
        expiresAt: Math.floor(Date.now() / 1000) + 1209600,
      },
    })
  );

  return { ok: true, incidentId, actionType: entryType || null };
}