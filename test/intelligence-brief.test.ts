import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { getIncidentIntelligence } from "../src/services/intelligence/brief";
import { GET as intelligenceGet } from "../src/app/api/incidents/[id]/intelligence/route";
import {
  PersistenceServiceError,
  saveIncident,
} from "../src/services/incident-persistence";
import {
  INTELLIGENCE_CORRELATION_FAILED_MESSAGE,
  INTELLIGENCE_CORRELATION_PENDING_MESSAGE,
  INTELLIGENCE_EXTRACTION_UNAVAILABLE_MESSAGE,
  INTELLIGENCE_NO_EVIDENCE_MESSAGE,
  INTELLIGENCE_NOT_PRESERVED_MESSAGE,
} from "../src/types/intelligence";
import type {
  CorrelationAnalysis,
  EvidenceRecord,
  IncidentCorrelationMeta,
  IncidentIntelligence,
  IncidentIntelligenceBrief,
} from "../src/types";

const INCIDENT_ID = "FF-20260920-ABCD";
const T0 = "2026-09-20T10:00:00.000Z";
const T1 = "2026-09-20T10:05:00.000Z";

const ENV: Record<string, string> = {
  AWS_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "test-key",
  AWS_SECRET_ACCESS_KEY: "test-secret",
  FRAUDFIRST_DYNAMODB_TABLE: "fraudfirst-incidents",
};

interface CommandCapture {
  commandName: string;
}

const store = new Map<string, Record<string, unknown>>();
const calls: CommandCapture[] = [];

function recordDdbSend(command: unknown): Promise<unknown> {
  const candidate = command as {
    constructor?: { name?: string };
    input?: Record<string, unknown>;
  };
  const name = candidate?.constructor?.name ?? "?";
  calls.push({ commandName: name });
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
  return Promise.resolve({});
}

test.before(() => {
  mock.method(DynamoDBDocumentClient.prototype, "send", recordDdbSend);
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
});

test.after(() => {
  mock.restoreAll();
  for (const key of Object.keys(ENV)) delete process.env[key];
});

test.beforeEach(() => {
  store.clear();
  calls.length = 0;
});

function evidence(
  id: string,
  overrides: Partial<EvidenceRecord> = {}
): EvidenceRecord {
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

function seedIncident(
  evidenceList: EvidenceRecord[] = [],
  existingCorrelation?: IncidentCorrelationMeta,
  extra?: Record<string, unknown>
): void {
  const base: Record<string, unknown> = {
    schemaVersion: 1,
    incidentId: INCIDENT_ID,
    status: "evidence_review",
    type: "upi_fraud",
    amount: null,
    createdAt: T0,
    startedAt: T0,
    updatedAt: T1,
    evidence: evidenceList,
    timeline: [
      {
        id: "tl_001",
        incidentId: INCIDENT_ID,
        type: "incident_started",
        tone: "info",
        label: "Incident started",
        occurredAt: T0,
      },
    ],
    nextAction: { primary: "Contact 1930", secondary: [] },
  };
  if (existingCorrelation) base.correlation = existingCorrelation;
  if (extra) {
    Object.assign(base, extra);
  }
  store.set(INCIDENT_ID, base);
}

function processedOne(): EvidenceRecord {
  return evidence("ev_one", {
    status: "processed",
    extraction: { source: "aws-textract", extractedAt: T0, textLength: 25 },
    storage: { status: "preserved", preservedAt: T0, s3Key: "s3://k" },
  });
}

function corpusAnalysis(
  evidenceIds: string[],
  rawOcrSnippet = "raw OCR content that must never surface"
): CorrelationAnalysis {
  return {
    facts: [
      {
        type: "transaction_amount",
        value: "24500",
        unit: "INR",
        confidence: 0.96,
        sourceEvidenceIds: evidenceIds,
        sourceText: rawOcrSnippet,
      },
      {
        type: "scam_type",
        value: "upi_transfer_authorized",
        confidence: 0.8,
        sourceEvidenceIds: evidenceIds,
        sourceText: rawOcrSnippet,
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
    identifiers: [
      { type: "account_last4", value: "4521", sourceEvidenceIds: evidenceIds },
    ],
    contactPoints: [
      {
        type: "phone",
        value: "+919876543210",
        sourceEvidenceIds: evidenceIds,
      },
    ],
    urls: [
      { value: "https://example.in/refund", sourceEvidenceIds: evidenceIds },
    ],
    missingInformation: [
      { field: "fraudster_name", reason: "not present in evidence" },
    ],
    uncertainInformation: [
      {
        field: "transaction_time",
        reason: "timestamp not readable",
        sourceEvidenceIds: evidenceIds,
      },
    ],
  };
}

function correlatedMeta(
  sourceIds: string[],
  analysis?: CorrelationAnalysis
): IncidentCorrelationMeta {
  return {
    status: "correlated",
    signature: "deadbeef".repeat(8),
    evidenceCount: sourceIds.length,
    readyCount: sourceIds.length,
    sourceEvidenceIds: sourceIds,
    notReadyEvidence: [],
    startedAt: T0,
    correlatedAt: T1,
    modelId: "nova-2",
    durationMs: 42,
    textLength: 100,
    analysis: analysis ?? corpusAnalysis(sourceIds),
  };
}

function failedMeta(
  analysis?: CorrelationAnalysis
): IncidentCorrelationMeta {
  return {
    status: "correlation_failed",
    signature: "deadbeef".repeat(8),
    evidenceCount: 1,
    readyCount: 1,
    sourceEvidenceIds: ["ev_one"],
    notReadyEvidence: [],
    startedAt: T1,
    correlatedAt: T1,
    modelId: "nova-2",
    error: {
      code: "BEDROCK_REQUEST_FAILED",
      message: "bedrock exploded",
    },
    ...(analysis ? { analysis } : {}),
  };
}

function asBrief(result: IncidentIntelligence): IncidentIntelligenceBrief {
  assert.equal(result.status, "ready");
  return (result as { brief: IncidentIntelligenceBrief }).brief;
}

test("A. an unknown incident returns INCIDENT_NOT_FOUND", async () => {
  await assert.rejects(
    getIncidentIntelligence(INCIDENT_ID),
    (error: unknown) =>
      error instanceof PersistenceServiceError &&
      error.code === "INCIDENT_NOT_FOUND"
  );
});

test("B. no evidence returns a not_ready brief with the no-evidence message", async () => {
  seedIncident([]);
  const result = await getIncidentIntelligence(INCIDENT_ID);
  assert.equal(result.status, "not_ready");
  if (result.status !== "not_ready") return;
  assert.equal(result.reason, "no_evidence");
  assert.equal(result.message, INTELLIGENCE_NO_EVIDENCE_MESSAGE);
});

test("C. unpreserved captured evidence returns the preserve message", async () => {
  seedIncident([
    evidence("ev_one", {
      status: "captured",
      storage: { status: "not_preserved" },
    }),
  ]);
  const result = await getIncidentIntelligence(INCIDENT_ID);
  assert.equal(result.status, "not_ready");
  if (result.status !== "not_ready") return;
  assert.equal(result.reason, "not_preserved");
  assert.equal(result.message, INTELLIGENCE_NOT_PRESERVED_MESSAGE);
});

test("D. preserved but not-extracted evidence returns the extraction-unavailable message", async () => {
  seedIncident([
    evidence("ev_one", {
      status: "captured",
      storage: { status: "preserved", preservedAt: T0, s3Key: "s3://k" },
    }),
  ]);
  const result = await getIncidentIntelligence(INCIDENT_ID);
  assert.equal(result.status, "not_ready");
  if (result.status !== "not_ready") return;
  assert.equal(result.reason, "extraction_unavailable");
  assert.equal(result.message, INTELLIGENCE_EXTRACTION_UNAVAILABLE_MESSAGE);
});

test("E. processed evidence without a correlation returns the pending message", async () => {
  seedIncident([processedOne()]);
  const result = await getIncidentIntelligence(INCIDENT_ID);
  assert.equal(result.status, "not_ready");
  if (result.status !== "not_ready") return;
  assert.equal(result.reason, "correlation_pending");
  assert.equal(result.message, INTELLIGENCE_CORRELATION_PENDING_MESSAGE);
});

test("F. a failed correlation with no prior success yields a failed brief without a previous brief", async () => {
  seedIncident([processedOne()], failedMeta());
  const result = await getIncidentIntelligence(INCIDENT_ID);
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.message, INTELLIGENCE_CORRELATION_FAILED_MESSAGE);
  assert.equal(result.errorCode, "BEDROCK_REQUEST_FAILED");
  assert.equal(result.previous, undefined);
});

test("F2. a failed correlation keeps the previous successful brief available", async () => {
  seedIncident([processedOne()], failedMeta(corpusAnalysis(["ev_one"])));
  const result = await getIncidentIntelligence(INCIDENT_ID);
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.message, INTELLIGENCE_CORRELATION_FAILED_MESSAGE);
  assert.ok(result.previous);
  assert.equal(result.previous.facts.length, 2);
  assert.equal(result.previous.facts[0].value, "24500");
});

test("G. a successful correlation yields a ready brief derived from the persisted analysis", async () => {
  seedIncident([processedOne()], correlatedMeta(["ev_one"]));
  const result = await getIncidentIntelligence(INCIDENT_ID);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  const brief = result.brief;
  assert.equal(brief.incidentId, INCIDENT_ID);
  assert.equal(brief.generatedAt, T1);
  assert.equal(brief.sourceCorrelationTimestamp, T1);
  assert.equal(brief.incidentType, "upi_fraud");
  assert.equal(brief.incidentTypeLabel, "UPI fraud");
  assert.equal(brief.modelId, "nova-2");
  assert.equal(brief.facts.length, 2);
  assert.equal(brief.facts[0].value, "24500");
  assert.equal(brief.timeline.length, 1);
  assert.equal(brief.timeline[0].event, "UPI transaction");
  assert.equal(brief.identifiers[0].value, "4521");
  assert.equal(brief.contactPoints[0].value, "+919876543210");
  assert.equal(brief.urls[0].value, "https://example.in/refund");
  assert.equal(brief.missingInformation[0].field, "fraudster_name");
  assert.equal(brief.uncertainInformation[0].field, "transaction_time");
  assert.ok(brief.summary.length > 0);
  assert.match(brief.summary, /^Incident UPI fraud:/);
});

test("H. the brief timeline comes only from the persisted correlation, never the incident timeline", async () => {
  seedIncident([processedOne()], correlatedMeta(["ev_one"]));
  const brief = asBrief(await getIncidentIntelligence(INCIDENT_ID));
  assert.equal(brief.timeline.length, 1);
  assert.deepEqual(
    brief.timeline.map((entry) => entry.event),
    ["UPI transaction"]
  );
});

test("I. every brief item preserves its sourceEvidenceIds", async () => {
  seedIncident(
    [
      processedOne(),
      evidence("ev_two", {
        status: "processed",
        extraction: { source: "aws-textract", extractedAt: T0, textLength: 25 },
      }),
    ],
    correlatedMeta(["ev_one", "ev_two"])
  );
  const brief = asBrief(await getIncidentIntelligence(INCIDENT_ID));
  assert.deepEqual(brief.facts[0].sourceEvidenceIds, ["ev_one", "ev_two"]);
  assert.deepEqual(brief.timeline[0].sourceEvidenceIds, ["ev_one", "ev_two"]);
  assert.deepEqual(brief.identifiers[0].sourceEvidenceIds, ["ev_one", "ev_two"]);
  assert.deepEqual(brief.contactPoints[0].sourceEvidenceIds, ["ev_one", "ev_two"]);
  assert.deepEqual(brief.urls[0].sourceEvidenceIds, ["ev_one", "ev_two"]);
  assert.deepEqual(brief.uncertainInformation[0].sourceEvidenceIds, [
    "ev_one",
    "ev_two",
  ]);
});

test("J. missing and uncertain information is preserved in the brief", async () => {
  const analysis = corpusAnalysis(["ev_one"]);
  analysis.missingInformation = [
    { field: "fraudster_name", reason: "not present in evidence" },
    { field: "card_number", reason: "cropped out of screenshot" },
  ];
  analysis.uncertainInformation = [
    {
      field: "transaction_time",
      reason: "timestamp not readable",
      sourceEvidenceIds: ["ev_one"],
    },
  ];
  seedIncident([processedOne()], correlatedMeta(["ev_one"], analysis));
  const brief = asBrief(await getIncidentIntelligence(INCIDENT_ID));
  assert.equal(brief.missingInformation.length, 2);
  assert.deepEqual(
    brief.missingInformation.map((entry) => entry.field),
    ["fraudster_name", "card_number"]
  );
  assert.equal(brief.uncertainInformation.length, 1);
  assert.equal(brief.uncertainInformation[0].reason, "timestamp not readable");
});

test("K. source evidence references are scoped to evidence that belongs to the incident", async () => {
  const analysis = corpusAnalysis(["ev_one"]);
  analysis.facts[0].sourceEvidenceIds = ["ev_one", "ev_hallucinated"];
  analysis.timelineCandidates[0].sourceEvidenceIds = ["ev_ghost"];
  seedIncident(
    [processedOne()],
    correlatedMeta(["ev_one", "ev_hallucinated"], analysis)
  );
  const brief = asBrief(await getIncidentIntelligence(INCIDENT_ID));
  assert.deepEqual(brief.facts[0].sourceEvidenceIds, ["ev_one"]);
  assert.equal(brief.timeline.length, 0);
  assert.deepEqual(brief.sourceEvidenceIds, ["ev_one"]);
});

test("L. a client-supplied fabricated intelligence blob is never surfaced", async () => {
  const fabricated = {
    summary: "fabricated summary from a client",
    factors: [{ type: "invented", value: "not real" }],
  };
  seedIncident([processedOne()], correlatedMeta(["ev_one"]), {
    intelligence: fabricated,
  });
  const result = await getIncidentIntelligence(INCIDENT_ID);
  assert.equal(result.status, "ready");
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("fabricated summary from a client"), false);
  const brief = asBrief(result);
  assert.equal(brief.summary.includes("fabricated summary from a client"), false);
});

test("M. repeated derivation from the same persisted record is deterministic", async () => {
  seedIncident([processedOne()], correlatedMeta(["ev_one"]));
  const first = await getIncidentIntelligence(INCIDENT_ID);
  const second = await getIncidentIntelligence(INCIDENT_ID);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("N. raw OCR text never appears in the brief output", async () => {
  const rawOcr = "raw OCR content that must never surface";
  seedIncident([processedOne()], correlatedMeta(["ev_one"], corpusAnalysis(["ev_one"], rawOcr)));
  const brief = asBrief(await getIncidentIntelligence(INCIDENT_ID));
  const serialized = JSON.stringify(brief);
  assert.equal(serialized.includes(rawOcr), false);
  assert.equal(serialized.includes("sourceText"), false);
  assert.equal("sourceText" in brief.facts[0], false);
});

test("O. route returns 400 for an invalid incident id", async () => {
  const response = await intelligenceGet(
    new Request("http://localhost/api/incidents/not-an-incident/intelligence", {
      method: "GET",
    }),
    { params: Promise.resolve({ id: "not-an-incident" }) }
  );
  const body = (await response.json()) as { ok: boolean; error: { code: string } };
  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "INVALID_INCIDENT");
});

test("O2. route returns 404 for an unknown incident", async () => {
  const response = await intelligenceGet(
    new Request(`http://localhost/api/incidents/${INCIDENT_ID}/intelligence`, {
      method: "GET",
    }),
    { params: Promise.resolve({ id: INCIDENT_ID }) }
  );
  const body = (await response.json()) as { ok: boolean; error: { code: string } };
  assert.equal(response.status, 404);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "INCIDENT_NOT_FOUND");
});

test("O3. route returns 200 with the intelligence result for a ready incident", async () => {
  seedIncident([processedOne()], correlatedMeta(["ev_one"]));
  const response = await intelligenceGet(
    new Request(`http://localhost/api/incidents/${INCIDENT_ID}/intelligence`, {
      method: "GET",
    }),
    { params: Promise.resolve({ id: INCIDENT_ID }) }
  );
  const body = (await response.json()) as {
    ok: boolean;
    intelligence: { status: string };
  };
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.intelligence.status, "ready");
});

test("P. a fresh build from a re-saved record serializes identically", async () => {
  seedIncident([processedOne()], correlatedMeta(["ev_one"]));
  const before = await getIncidentIntelligence(INCIDENT_ID);
  const current = store.get(INCIDENT_ID);
  assert.ok(current);
  await saveIncident(current);
  const after = await getIncidentIntelligence(INCIDENT_ID);
  assert.equal(JSON.stringify(after), JSON.stringify(before));
});

test("Q. the previous successful brief is identical to the last success", async () => {
  seedIncident([processedOne()], correlatedMeta(["ev_one"]));
  const first = asBrief(await getIncidentIntelligence(INCIDENT_ID));

  const failingMeta: IncidentCorrelationMeta = {
    status: "correlation_failed",
    signature: "beefdead".repeat(8),
    evidenceCount: 1,
    readyCount: 1,
    sourceEvidenceIds: ["ev_one"],
    notReadyEvidence: [],
    startedAt: "2026-09-20T11:00:00.000Z",
    correlatedAt: T1,
    modelId: "nova-2",
    error: { code: "BEDROCK_REQUEST_FAILED", message: "exploded" },
    analysis: corpusAnalysis(["ev_one"]),
  };
  store.set(INCIDENT_ID, {
    ...(store.get(INCIDENT_ID) as Record<string, unknown>),
    correlation: failingMeta,
  });

  const result = await getIncidentIntelligence(INCIDENT_ID);
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.ok(result.previous);
  assert.equal(JSON.stringify(result.previous), JSON.stringify(first));
});

test("R. financial references are the financial subset of facts only", async () => {
  seedIncident([processedOne()], correlatedMeta(["ev_one"]));
  const brief = asBrief(await getIncidentIntelligence(INCIDENT_ID));
  assert.equal(brief.facts.length, 2);
  assert.equal(brief.financialReferences.length, 1);
  assert.equal(brief.financialReferences[0].type, "transaction_amount");
  assert.equal(brief.financialReferences[0].value, "24500");
  assert.equal(
    brief.financialReferences.some((fact) => fact.type === "scam_type"),
    false
  );
  const financialValues = brief.financialReferences.map((fact) => fact.value);
  assert.ok(financialValues.every((value) => brief.facts.some((f) => f.value === value)));
});

test("S. brief sourceEvidenceIds are unique, ordered, and scoped to the incident", async () => {
  const analysis = corpusAnalysis(["ev_two", "ev_one", "ev_two"]);
  seedIncident(
    [
      processedOne(),
      evidence("ev_two", {
        status: "processed",
        extraction: { source: "aws-textract", extractedAt: T0, textLength: 25 },
      }),
    ],
    {
      status: "correlated",
      signature: "cafebabe".repeat(8),
      evidenceCount: 2,
      readyCount: 2,
      sourceEvidenceIds: [],
      notReadyEvidence: [],
      startedAt: T0,
      correlatedAt: T1,
      modelId: "nova-2",
      durationMs: 42,
      textLength: 100,
      analysis,
    }
  );
  const brief = asBrief(await getIncidentIntelligence(INCIDENT_ID));
  assert.deepEqual(brief.facts[0].sourceEvidenceIds, ["ev_two", "ev_one"]);
  assert.deepEqual(brief.sourceEvidenceIds, ["ev_two", "ev_one"]);
});