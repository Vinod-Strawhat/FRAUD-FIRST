import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

import { correlateEvidenceWithFallback } from "../src/services/providers/correlate";
import type { CorrelateEvidenceBatchItemInput } from "../src/services/providers/correlate";
import { correlateIncidentEvidence } from "../src/services/correlation/orchestrate";
import { CorrelationServiceError } from "../src/services/correlation";
import { canonicalizeIncidentCorrelation, getIncident } from "../src/services/incident-persistence";
import type {
  CorrelationAnalysis,
  CorrelationTextClaim,
  EvidenceRecord,
} from "../src/types";

const INCIDENT_ID = "FF-20260920-ABCD";
const T0 = "2026-09-20T10:00:00.000Z";

const ENV: Record<string, string> = {
  AWS_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "test-key",
  AWS_SECRET_ACCESS_KEY: "test-secret",
  FRAUDFIRST_BEDROCK_MODEL_ID: "us.amazon.nova-2-lite-v1:0",
  FRAUDFIRST_DYNAMODB_TABLE: "fraudfirst-incidents",
};

function invariantValidationError(): Error {
  const error = new Error(
    "The configured model is not available for invocation."
  );
  error.name = "ValidationException";
  return error;
}

function providerItem(evidenceId: string, text: string): CorrelateEvidenceBatchItemInput {
  return {
    incidentId: INCIDENT_ID,
    evidenceId,
    filename: `${evidenceId}.jpg`,
    mimeType: "image/jpeg",
    category: "unclassified",
    status: "processed",
    text,
  };
}

function corpusAnalysis(evidenceIds: string[]): CorrelationAnalysis {
  return {
    facts: [
      {
        type: "transaction_amount",
        value: "24500",
        unit: "INR",
        confidence: 0.96,
        sourceEvidenceIds: evidenceIds,
        sourceText: "Rs. 24500 debited",
      },
    ],
    timelineCandidates: [
      {
        timestamp: null,
        event: "UPI transaction",
        sourceEvidenceIds: evidenceIds,
        confidence: 0.9,
        label: "CANDIDATE / UNCERTAIN",
      },
    ],
    identifiers: [],
    contactPoints: [],
    urls: [],
    missingInformation: [],
    uncertainInformation: [],
  };
}

let bedrockSendImpl: () => unknown = () => ({});
let fetchImpl: () => Promise<Response> = async () => {
  throw new Error("Unexpected network call in correlation fallback test.");
};

const store = new Map<string, Record<string, unknown>>();

function recordDdbSend(command: unknown): Promise<unknown> {
  const candidate = command as {
    constructor?: { name?: string };
    input?: Record<string, unknown>;
  };
  const name = candidate?.constructor?.name ?? "?";
  const params = candidate?.input ?? {};
  if (name === "GetCommand") {
    const key = (params.Key as { incidentId?: string } | undefined)?.incidentId;
    return Promise.resolve(
      key !== undefined && store.has(key) ? { Item: store.get(key) } : {}
    );
  }
  if (name === "PutCommand") {
    const item = (params.Item ?? {}) as { incidentId?: string };
    if (item.incidentId !== undefined) {
      store.set(item.incidentId, item as Record<string, unknown>);
    }
    return Promise.resolve({});
  }
  if (name === "DeleteCommand") {
    const key = (params.Key as { incidentId?: string } | undefined)?.incidentId;
    if (key !== undefined) store.delete(key);
    return Promise.resolve({});
  }
  return Promise.resolve({});
}

test.before(() => {
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  mock.method(BedrockRuntimeClient.prototype, "send", async () => bedrockSendImpl());
  mock.method(DynamoDBDocumentClient.prototype, "send", recordDdbSend);
  mock.method(globalThis, "fetch", async () => fetchImpl());
});

test.beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.FRAUDFIRST_OPENROUTER_MODEL_ID;
  store.clear();
});

test.after(() => {
  mock.restoreAll();
  for (const key of Object.keys(ENV)) delete process.env[key];
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.FRAUDFIRST_OPENROUTER_MODEL_ID;
});

test("A. Bedrock invalid_request enters the fallback path", async () => {
  bedrockSendImpl = () => {
    throw invariantValidationError();
  };

  const result = await correlateEvidenceWithFallback([
    providerItem("ev_a", "Rs. 24,500 debited"),
  ]);

  assert.equal(result.provider, "local");
  assert.equal(result.providerMode, "fallback");
});

test("B. Bedrock provider failure falls back to a successful local correlation", async () => {
  bedrockSendImpl = () => {
    throw invariantValidationError();
  };

  const items = [
    providerItem(
      "ev_a",
      "Paid Rs. 24,500 to xyz@okhdfc on 20/09/2026 at 6:42 PM. UTR 334455667788."
    ),
    providerItem(
      "ev_b",
      "Received Rs. 24500 same transaction. Ref No 334455667788. UPI xyz@okhdfc."
    ),
  ];
  const result = await correlateEvidenceWithFallback(items);

  assert.equal(result.provider, "local");
  assert.equal(result.providerMode, "fallback");
  assert.equal(result.modelId, "local-deterministic-v1");
  assert.equal(result.analysis.facts[0].type, "transaction_amount");
  assert.equal(result.analysis.facts[0].value, "24500");
  const contributingIds = result.analysis.facts.flatMap((fact) => fact.sourceEvidenceIds);
  assert.ok(contributingIds.includes("ev_a"));
  assert.ok(contributingIds.includes("ev_b"));
});

test("C. a successful local fallback honestly reports provider local with providerMode fallback", async () => {
  bedrockSendImpl = () => {
    throw invariantValidationError();
  };

  const result = await correlateEvidenceWithFallback([
    providerItem("ev_a", "Rs. 24,500 debited"),
  ]);

  assert.equal(result.provider, "local");
  assert.equal(result.providerMode, "fallback");
  assert.equal(result.modelId, "local-deterministic-v1");
  assert.ok(result.textLength > 0);
});

test("D. a Bedrock success remains provider bedrock with providerMode primary", async () => {
  bedrockSendImpl = () => ({
    output: { message: { content: [{ text: JSON.stringify(corpusAnalysis(["ev_a"])) }] } },
    stopReason: "end_turn",
  });

  const result = await correlateEvidenceWithFallback([
    providerItem("ev_a", "Rs. 24,500 debited"),
  ]);

  assert.equal(result.provider, "bedrock");
  assert.equal(result.providerMode, "primary");
  assert.equal(result.modelId, ENV.FRAUDFIRST_BEDROCK_MODEL_ID);
  assert.equal(result.analysis.facts[0].value, "24500");
});

test("E. an application-side invalid model output is not converted into provider fallback", async () => {
  bedrockSendImpl = () => ({
    output: { message: { content: [{ text: "this is not the correlation JSON" }] } },
    stopReason: "end_turn",
  });

  await assert.rejects(
    correlateEvidenceWithFallback([providerItem("ev_a", "Rs. 24,500 debited")]),
    (error: unknown) =>
      error instanceof CorrelationServiceError && error.code === "BEDROCK_INVALID_OUTPUT"
  );
});

test("E2. an unrecognized Bedrock failure kind surfaces as BEDROCK_REQUEST_FAILED, not fallback", async () => {
  bedrockSendImpl = () => {
    throw new Error("generic application side error");
  };

  await assert.rejects(
    correlateEvidenceWithFallback([providerItem("ev_a", "Rs. 24,500 debited")]),
    (error: unknown) =>
      error instanceof CorrelationServiceError && error.code === "BEDROCK_REQUEST_FAILED"
  );
});

test("F. the existing OpenRouter fallback remains intact", async () => {
  bedrockSendImpl = () => {
    throw invariantValidationError();
  };
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  fetchImpl = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(corpusAnalysis(["ev_a"])) } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  const result = await correlateEvidenceWithFallback([
    providerItem("ev_a", "Rs. 24,500 debited"),
  ]);

  assert.equal(result.provider, "openrouter");
  assert.equal(result.providerMode, "fallback");
  assert.equal(result.modelId, "meta-llama/llama-4-maverick");
  assert.equal(result.analysis.facts[0].value, "24500");
});

test("G. correlateIncidentEvidence persists provider and providerMode when the local fallback succeeds", async () => {
  bedrockSendImpl = () => {
    throw invariantValidationError();
  };
  seedIncident([
    evidence("ev_a", {
      status: "processed",
      mimeType: "image/png",
      extraction: { source: "aws-textract", extractedAt: T0, textLength: 90 },
    }),
    evidence("ev_b", {
      status: "processed",
      extraction: { source: "aws-textract", extractedAt: T0, textLength: 80 },
    }),
  ]);

  const meta = await correlateIncidentEvidence(INCIDENT_ID, [
    claimFor("ev_a", "Paid Rs. 24,500 to xyz@okhdfc on 20/09/2026 at 6:42 PM. UTR 334455667788."),
    claimFor("ev_b", "Received Rs. 24500 same transaction. Ref No 334455667788. UPI xyz@okhdfc."),
  ]);

  assert.equal(meta.status, "correlated");
  assert.equal(meta.provider, "local");
  assert.equal(meta.providerMode, "fallback");
  assert.deepEqual(meta.sourceEvidenceIds, ["ev_a", "ev_b"]);

  const stored = store.get(INCIDENT_ID) as { correlation?: unknown };
  const canonical = canonicalizeIncidentCorrelation(stored.correlation);
  assert.equal(canonical.provider, "local");
  assert.equal(canonical.providerMode, "fallback");

  const reloaded = await getIncident(INCIDENT_ID);
  assert.equal(reloaded?.correlation?.provider, "local");
  assert.equal(reloaded?.correlation?.providerMode, "fallback");
});

function evidence(id: string, overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id,
    incidentId: INCIDENT_ID,
    filename: `${id}.jpg`,
    mimeType: "image/jpeg",
    size: 1024,
    category: "unclassified",
    status: "captured",
    capturedAt: T0,
    ...overrides,
  } as EvidenceRecord;
}

function claimFor(evidenceId: string, text: string): CorrelationTextClaim {
  return { evidenceId, text, source: "aws-textract", extractedAt: T0 };
}

function seedIncident(evidenceList: EvidenceRecord[]): void {
  store.set(INCIDENT_ID, {
    schemaVersion: 1,
    incidentId: INCIDENT_ID,
    status: "evidence_review",
    type: "upi_fraud",
    amount: null,
    createdAt: T0,
    startedAt: T0,
    updatedAt: T0,
    evidence: evidenceList,
    timeline: [],
  });
}