import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { correlateIncidentEvidence } from "../src/services/correlation/orchestrate";
import { normalizeCorrelationOutput } from "../src/services/correlation/schema";
import { CorrelationServiceError } from "../src/services/correlation";
import { POST as correlateIncidentPost } from "../src/app/api/evidence/correlate-incident/route";
import {
  canonicalizeIncidentCorrelation,
  getIncident,
  PersistenceServiceError,
  saveIncident,
} from "../src/services/incident-persistence";
import { buildIncidentWorkspaceRecord } from "../src/lib/incident-record";
import type {
  CorrelationAnalysis,
  CorrelationTextClaim,
  EvidenceRecord,
  IncidentCorrelationMeta,
  IncidentWorkspaceSnapshot,
} from "../src/types";

const INCIDENT_ID = "FF-20260920-ABCD";
const T0 = "2026-09-20T10:00:00.000Z";

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
  if (name === "DeleteCommand") {
    const key = (params.Key as { incidentId?: string } | undefined)?.incidentId;
    if (key !== undefined) store.delete(key);
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
  existingCorrelation?: IncidentCorrelationMeta
): void {
  const base: Record<string, unknown> = {
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
  };
  if (existingCorrelation) base.correlation = existingCorrelation;
  store.set(INCIDENT_ID, base);
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

function claimFor(evidenceId: string, text = "Rs. 24500 debited from account"): CorrelationTextClaim {
  return { evidenceId, text, source: "aws-textract", extractedAt: T0 };
}

function timelineTypes(): string[] {
  const item = store.get(INCIDENT_ID) as { timeline?: unknown[] } | undefined;
  const events = Array.isArray(item?.timeline) ? item.timeline : [];
  return events
    .map((entry) =>
      typeof entry === "object" && entry !== null
        ? (entry as { type?: string }).type
        : undefined
    )
    .filter((type): type is string => typeof type === "string");
}

test("A. no evidence returns a persisted not_ready meta without contacting the provider", async () => {
  seedIncident([]);
  let providerCalled = false;
  const meta = await correlateIncidentEvidence(INCIDENT_ID, [], async () => {
    providerCalled = true;
    return { modelId: "m", durationMs: 1, textLength: 0, analysis: undefined };
  });

  assert.equal(meta.status, "not_ready");
  assert.equal(meta.evidenceCount, 0);
  assert.equal(meta.readyCount, 0);
  assert.notEqual(meta.signature, "");
  assert.equal(providerCalled, false);
  assert.equal(timelineTypes().includes("correlation_started"), false);

  const stored = store.get(INCIDENT_ID) as { correlation?: unknown };
  assert.equal(canonicalizeIncidentCorrelation(stored.correlation).status, "not_ready");
});

test("B. captured evidence without text yields a not_ready meta explaining it is not extracted", async () => {
  seedIncident([
    evidence("ev_one", { status: "captured", storage: { status: "not_preserved" } }),
  ]);
  const meta = await correlateIncidentEvidence(INCIDENT_ID, []);

  assert.equal(meta.status, "not_ready");
  assert.equal(meta.readyCount, 0);
  assert.equal(meta.notReadyEvidence.length, 1);
  assert.equal(meta.notReadyEvidence[0].state, "not_extracted");
  assert.equal(meta.notReadyEvidence[0].evidenceId, "ev_one");
});

test("C. failed extraction yields a not_ready meta with extraction_failed state", async () => {
  seedIncident([evidence("ev_bad", { status: "failed" })]);
  const meta = await correlateIncidentEvidence(INCIDENT_ID, []);

  assert.equal(meta.status, "not_ready");
  assert.equal(meta.notReadyEvidence[0].state, "extraction_failed");
});

test("D. one processed evidence with session text correlates through the provider", async () => {
  seedIncident([
    evidence("ev_alpha", {
      status: "processed",
      extraction: { source: "aws-textract", extractedAt: T0, textLength: 25 },
    }),
  ]);
  let received: unknown[] | undefined = undefined;
  const meta = await correlateIncidentEvidence(INCIDENT_ID, [claimFor("ev_alpha")], async (items) => {
    received = items;
    return {
      modelId: "nova-2",
      durationMs: 42,
      textLength: 25,
      analysis: corpusAnalysis(["ev_alpha"]),
    };
  });

  assert.equal(meta.status, "correlated");
  assert.equal(meta.readyCount, 1);
  assert.deepEqual(meta.sourceEvidenceIds, ["ev_alpha"]);
  assert.equal(meta.analysis?.facts[0].sourceEvidenceIds[0], "ev_alpha");
  assert.ok(Array.isArray(received));
  const sent = (received as {
    evidenceId: string;
    incidentId?: string;
    category?: string;
    status?: string;
  }[])[0];
  assert.equal(sent.evidenceId, "ev_alpha");
  assert.equal(sent.incidentId, INCIDENT_ID);
  assert.equal(sent.category, "unclassified");
  assert.equal(sent.status, "processed");
  assert.deepEqual(timelineTypes(), ["correlation_started", "correlation_completed"]);
});

test("E. multiple processed evidence correlates as one batch", async () => {
  seedIncident([
    evidence("ev_alpha", {
      status: "processed",
      extraction: { source: "aws-textract", extractedAt: T0, textLength: 10 },
    }),
    evidence("ev_beta", {
      status: "processed",
      extraction: { source: "aws-textract", extractedAt: T0, textLength: 10 },
    }),
  ]);
  let receivedCount = 0;
  const meta = await correlateIncidentEvidence(
    INCIDENT_ID,
    [claimFor("ev_alpha", "alpha text"), claimFor("ev_beta", "beta text")],
    async (items) => {
      receivedCount = items.length;
      return {
        modelId: "nova-2",
        durationMs: 50,
        textLength: 20,
        analysis: corpusAnalysis(["ev_alpha", "ev_beta"]),
      };
    }
  );

  assert.equal(meta.status, "correlated");
  assert.equal(receivedCount, 2);
  assert.deepEqual(meta.sourceEvidenceIds, ["ev_alpha", "ev_beta"]);
});

test("F. mixed readiness correlates the ready subset and reports the rest, preserving both", async () => {
  seedIncident([
    evidence("ev_ready", {
      status: "processed",
      extraction: { source: "aws-textract", extractedAt: T0, textLength: 9 },
    }),
    evidence("ev_waiting", { status: "captured", storage: { status: "not_preserved" } }),
    evidence("ev_fail", { status: "failed" }),
  ]);
const meta = await correlateIncidentEvidence(
    INCIDENT_ID,
    [claimFor("ev_ready", "ready text")],
    async (items) => {
      void items;
      return {
        modelId: "nova-2",
        durationMs: 1,
        textLength: 9,
        analysis: corpusAnalysis(["ev_ready"]),
      };
    }
  );

  assert.equal(meta.status, "correlated");
  assert.equal(meta.readyCount, 1);
  assert.deepEqual(meta.sourceEvidenceIds, ["ev_ready"]);
  const states = meta.notReadyEvidence.map((entry) => entry.state).sort();
  assert.deepEqual(states, ["extraction_failed", "not_extracted"]);
});

test("G. a preserved but not-extracted-now evidence is not treated as successful correlation", async () => {
  seedIncident([
    evidence("ev_preserved", {
      status: "processed",
      extraction: { source: "aws-textract", extractedAt: T0, textLength: 12 },
      storage: { status: "preserved", preservedAt: T0, s3Key: "s3://key" },
    }),
  ]);
  const meta = await correlateIncidentEvidence(INCIDENT_ID, []);

  assert.equal(meta.status, "not_ready");
  assert.equal(meta.readyCount, 0);
  assert.equal(meta.notReadyEvidence[0].state, "preserved_extraction_unavailable");
  assert.equal(meta.analysis, undefined);
});

test("H. a provider failure becomes a persisted correlation_failed meta with a timeline failure event", async () => {
  seedIncident([
    evidence("ev_alpha", {
      status: "processed",
      extraction: { source: "aws-textract", extractedAt: T0, textLength: 25 },
    }),
  ]);
  const meta = await correlateIncidentEvidence(
    INCIDENT_ID,
    [claimFor("ev_alpha")],
    async () => {
      throw new Error("bedrock exploded");
    }
  );

  assert.equal(meta.status, "correlation_failed");
  assert.equal(meta.error?.code, "BEDROCK_REQUEST_FAILED");
  assert.ok(meta.error?.message);
  assert.equal(
    timelineTypes().filter((type) => type === "correlation_failed").length,
    1
  );
});

test("I. a completed run is idempotent: the second run reuses the stored result", async () => {
  seedIncident([
    evidence("ev_alpha", {
      status: "processed",
      extraction: { source: "aws-textract", extractedAt: T0, textLength: 25 },
    }),
  ]);
  let providerCalls = 0;
  const provider = async () => {
    providerCalls += 1;
    return {
      modelId: "nova-2",
      durationMs: 10,
      textLength: 25,
      analysis: corpusAnalysis(["ev_alpha"]),
    };
  };

  const first = await correlateIncidentEvidence(INCIDENT_ID, [claimFor("ev_alpha")], provider);
  const second = await correlateIncidentEvidence(INCIDENT_ID, [claimFor("ev_alpha")], provider);

  assert.equal(first.status, "correlated");
  assert.equal(second.status, "correlated");
  assert.equal(providerCalls, 1);
  assert.equal(
    timelineTypes().filter((type) => type === "correlation_completed").length,
    1
  );
});

test("J. sourceEvidenceIds from the provider are preserved in the persisted analysis", async () => {
  seedIncident([
    evidence("ev_alpha", {
      status: "processed",
      extraction: { source: "aws-textract", extractedAt: T0, textLength: 25 },
    }),
  ]);
  await correlateIncidentEvidence(
    INCIDENT_ID,
    [claimFor("ev_alpha")],
    async () => ({
      modelId: "nova-2",
      durationMs: 1,
      textLength: 25,
      analysis: corpusAnalysis(["ev_alpha"]),
    })
  );

  const stored = store.get(INCIDENT_ID) as { correlation?: IncidentCorrelationMeta };
  assert.deepEqual(stored.correlation?.analysis?.facts[0].sourceEvidenceIds, ["ev_alpha"]);
  assert.deepEqual(stored.correlation?.analysis?.timelineCandidates[0].sourceEvidenceIds, ["ev_alpha"]);
});

test("K. normalizeCorrelationOutput filters hallucinated source evidence ids to the allowed set", () => {
  const raw = {
    facts: [
      {
        type: "transaction_amount",
        value: "24500",
        confidence: 0.9,
        sourceEvidenceIds: ["ev_real", "ev_hallucinated"],
        sourceText: "24500",
      },
    ],
    timelineCandidates: [],
    identifiers: [],
    contactPoints: [],
    urls: [],
    missingInformation: [],
    uncertainInformation: [],
  };

  const analysis = normalizeCorrelationOutput(raw, "ev_real", ["ev_real"]);
  assert.deepEqual(analysis.facts[0].sourceEvidenceIds, ["ev_real"]);
});

test("L. no duplicate timeline events when re-running an already-correlating incident", async () => {
  const correlatingMeta: IncidentCorrelationMeta = {
    status: "correlating",
    signature: "deadbeef".repeat(8),
    evidenceCount: 1,
    readyCount: 1,
    sourceEvidenceIds: ["ev_alpha"],
    notReadyEvidence: [],
    startedAt: new Date().toISOString(),
  };
  seedIncident(
    [
      evidence("ev_alpha", {
        status: "processed",
        extraction: { source: "aws-textract", extractedAt: T0, textLength: 25 },
      }),
    ],
    correlatingMeta
  );

  const meta = await correlateIncidentEvidence(INCIDENT_ID, [claimFor("ev_alpha")]);

  assert.equal(meta.status, "correlating");
  assert.equal(
    timelineTypes().filter((type) => type === "correlation_started").length,
    0
  );
});

test("M. correlation meta survives a canonical saveIncident round-trip from a client that omits it", async () => {
  seedIncident([
    evidence("ev_alpha", {
      status: "processed",
      extraction: { source: "aws-textract", extractedAt: T0, textLength: 25 },
    }),
  ]);
  await correlateIncidentEvidence(INCIDENT_ID, [claimFor("ev_alpha")], async () => ({
    modelId: "nova-2",
    durationMs: 1,
    textLength: 25,
    analysis: corpusAnalysis(["ev_alpha"]),
  }));

  const stored = await getIncident(INCIDENT_ID);
  assert.equal(stored?.correlation?.status, "correlated");

  const clientView = {
    schemaVersion: 1,
    incidentId: INCIDENT_ID,
    status: stored?.status,
    type: stored?.type,
    amount: stored?.amount,
    createdAt: stored?.createdAt,
    startedAt: stored?.startedAt,
    updatedAt: "2026-09-20T11:00:00.000Z",
    evidence: stored?.evidence,
    timeline: stored?.timeline,
    nextAction: { primary: "Contact 1930", secondary: [] },
  } as unknown;

  const { record } = await saveIncident(clientView);
  assert.equal(record.correlation?.status, "correlated");
  assert.equal(record.correlation?.modelId, "nova-2");
});

test("N. invalid incident ids are rejected and claims referencing unknown evidence ids are rejected", async () => {
  await assert.rejects(
    correlateIncidentEvidence("not-an-incident", []),
    (error: unknown) =>
      error instanceof PersistenceServiceError && error.code === "INVALID_INCIDENT"
  );

  seedIncident([]);
  await assert.rejects(
    correlateIncidentEvidence(INCIDENT_ID, [
      { evidenceId: "ev_unknown", text: "claim for an evidence id that does not exist" },
    ]),
    (error: unknown) =>
      error instanceof PersistenceServiceError && error.code === "EVIDENCE_NOT_FOUND"
  );
});

test("correlating runs expire after the staleness window", async () => {
  const staleStartedAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const correlatingMeta: IncidentCorrelationMeta = {
    status: "correlating",
    signature: "deadbeef".repeat(8),
    evidenceCount: 1,
    readyCount: 1,
    sourceEvidenceIds: ["ev_alpha"],
    notReadyEvidence: [],
    startedAt: staleStartedAt,
  };
  seedIncident(
    [
      evidence("ev_alpha", {
        status: "processed",
        extraction: { source: "aws-textract", extractedAt: T0, textLength: 25 },
      }),
    ],
    correlatingMeta
  );

  let providerCalls = 0;
  const meta = await correlateIncidentEvidence(INCIDENT_ID, [claimFor("ev_alpha")], async () => {
    providerCalls += 1;
    return {
      modelId: "nova-2",
      durationMs: 1,
      textLength: 25,
      analysis: corpusAnalysis(["ev_alpha"]),
    };
  });

  assert.equal(meta.status, "correlated");
  assert.equal(providerCalls, 1);
});

test("route. invalid incident id returns a 400 with INCIDENT_NOT_FOUND", async () => {
  const response = await correlateIncidentPost(
    new Request("http://localhost/api/evidence/correlate-incident", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ incidentId: "not-an-incident", claims: [] }),
    })
  );
  const body = (await response.json()) as { ok: boolean; error: { code: string } };
  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "INCIDENT_NOT_FOUND");
});

test("route. nonexistent incident returns a 404 with INCIDENT_NOT_FOUND", async () => {
  const response = await correlateIncidentPost(
    new Request("http://localhost/api/evidence/correlate-incident", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ incidentId: INCIDENT_ID, claims: [] }),
    })
  );
  const body = (await response.json()) as { ok: boolean; error: { code: string } };
  assert.equal(response.status, 404);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "INCIDENT_NOT_FOUND");
});

test("route. oversized claims return a 413 with INVALID_REQUEST", async () => {
  seedIncident([]);
  const response = await correlateIncidentPost(
    new Request("http://localhost/api/evidence/correlate-incident", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        incidentId: INCIDENT_ID,
        claims: Array.from({ length: 501 }, (_, i) => ({
          evidenceId: `ev_pad_${i}`,
          text: "x",
        })),
      }),
    })
  );
  const body = (await response.json()) as { ok: boolean; error: { code: string } };
  assert.equal(response.status, 413);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "INVALID_REQUEST");
});

test("route. an invalid claim shape returns a 400", async () => {
  seedIncident([]);
  const response = await correlateIncidentPost(
    new Request("http://localhost/api/evidence/correlate-incident", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        incidentId: INCIDENT_ID,
        claims: [{ evidenceId: "ev_x" }],
      }),
    })
  );
  const body = (await response.json()) as { ok: boolean; error: { code: string } };
  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "EXTRACTION_NOT_AVAILABLE");
});

test("route. no ready evidence returns ok with a not_ready correlation", async () => {
  seedIncident([]);
  const response = await correlateIncidentPost(
    new Request("http://localhost/api/evidence/correlate-incident", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ incidentId: INCIDENT_ID, claims: [] }),
    })
  );
  const body = (await response.json()) as {
    ok: boolean;
    incidentId: string;
    correlation: { status: string };
  };
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.incidentId, INCIDENT_ID);
  assert.equal(body.correlation.status, "not_ready");
});

test("C2. processing extraction remains not-ready", async () => {
  seedIncident([
    evidence("ev_working", {
      status: "processing",
      extraction: { source: "aws-textract", extractedAt: T0, textLength: 0 },
    }),
  ]);
  let providerCalled = false;
  const meta = await correlateIncidentEvidence(
    INCIDENT_ID,
    [],
    async () => {
      providerCalled = true;
      return {
        modelId: "m",
        durationMs: 1,
        textLength: 0,
        analysis: undefined,
      };
    }
  );

  assert.equal(meta.status, "not_ready");
  assert.equal(meta.readyCount, 0);
  assert.equal(meta.notReadyEvidence[0].state, "processing");
  assert.equal(providerCalled, false);
});

test("H2. a changed evidence set produces a new signature and re-correlates", async () => {
  seedIncident([
    evidence("ev_alpha", {
      status: "processed",
      extraction: { source: "aws-textract", extractedAt: T0, textLength: 10 },
    }),
  ]);
  let providerCalls = 0;
  const provider = async (items: unknown[]) => {
    providerCalls += 1;
    return {
      modelId: "nova-2",
      durationMs: 5,
      textLength: items.length * 10,
      analysis: corpusAnalysis(items.map((item) => (item as { evidenceId: string }).evidenceId)),
    };
  };

  const first = await correlateIncidentEvidence(
    INCIDENT_ID,
    [claimFor("ev_alpha", "alpha text")],
    provider
  );

  const stored = store.get(INCIDENT_ID) as { evidence?: unknown[] };
  stored.evidence = [
    ...(stored.evidence ?? []),
    evidence("ev_gamma", {
      status: "processed",
      extraction: { source: "aws-textract", extractedAt: T0, textLength: 10 },
    }),
  ];

  const second = await correlateIncidentEvidence(
    INCIDENT_ID,
    [claimFor("ev_alpha", "alpha text"), claimFor("ev_gamma", "gamma text")],
    provider
  );

  assert.notEqual(first.signature, second.signature);
  assert.equal(second.status, "correlated");
  assert.equal(second.readyCount, 2);
  assert.equal(providerCalls, 2);
  assert.deepEqual(second.sourceEvidenceIds, ["ev_alpha", "ev_gamma"]);
});

test("I2. a failed new correlation preserves the previous successful correlation", async () => {
  seedIncident([
    evidence("ev_alpha", {
      status: "processed",
      extraction: { source: "aws-textract", extractedAt: T0, textLength: 25 },
    }),
  ]);
  let shouldFail = false;
  const provider = async () => {
    if (shouldFail) {
      throw new Error("bedrock exploded on retry");
    }
    return {
      modelId: "nova-2",
      durationMs: 10,
      textLength: 25,
      analysis: corpusAnalysis(["ev_alpha"]),
    };
  };

  const first = await correlateIncidentEvidence(INCIDENT_ID, [claimFor("ev_alpha")], provider);
  assert.equal(first.status, "correlated");

  shouldFail = true;
  const second = await correlateIncidentEvidence(
    INCIDENT_ID,
    [claimFor("ev_alpha", "re-extracted text that produces a new signature")],
    provider
  );

  assert.notEqual(second.signature, first.signature);
  assert.equal(second.status, "correlation_failed");
  assert.equal(second.error?.code, "BEDROCK_REQUEST_FAILED");
  assert.equal(second.modelId, "nova-2");
  assert.equal(second.correlatedAt, first.correlatedAt);
  assert.deepEqual(second.analysis, first.analysis);

  const stored = store.get(INCIDENT_ID) as { correlation?: unknown };
  assert.equal(canonicalizeIncidentCorrelation(stored.correlation).analysis?.facts[0].value, "24500");
});

test("J2. an unavailable AI provider produces a persisted correlation_failed state with the provider code", async () => {
  seedIncident([
    evidence("ev_alpha", {
      status: "processed",
      extraction: { source: "aws-textract", extractedAt: T0, textLength: 25 },
    }),
  ]);
  const meta = await correlateIncidentEvidence(
    INCIDENT_ID,
    [claimFor("ev_alpha")],
    async () => {
      throw new CorrelationServiceError(
        "BEDROCK_NOT_CONFIGURED",
        "AI correlation is not configured for this environment."
      );
    }
  );

  assert.equal(meta.status, "correlation_failed");
  assert.equal(meta.error?.code, "BEDROCK_NOT_CONFIGURED");
  const stored = store.get(INCIDENT_ID) as { correlation?: unknown };
  assert.equal(canonicalizeIncidentCorrelation(stored.correlation).error?.code, "BEDROCK_NOT_CONFIGURED");
});

test("K2. retry after a failure stays timeline-idempotent for the completed event", async () => {
  seedIncident([
    evidence("ev_alpha", {
      status: "processed",
      extraction: { source: "aws-textract", extractedAt: T0, textLength: 25 },
    }),
  ]);
  let shouldFail = true;
  const provider = async () => {
    if (shouldFail) {
      throw new Error("transient bed failure");
    }
    return {
      modelId: "nova-2",
      durationMs: 10,
      textLength: 25,
      analysis: corpusAnalysis(["ev_alpha"]),
    };
  };

  const failed = await correlateIncidentEvidence(INCIDENT_ID, [claimFor("ev_alpha")], provider);
  assert.equal(failed.status, "correlation_failed");

  shouldFail = false;
  const completed = await correlateIncidentEvidence(INCIDENT_ID, [claimFor("ev_alpha")], provider);
  assert.equal(completed.status, "correlated");
  assert.equal(
    timelineTypes().filter((type) => type === "correlation_completed").length,
    1
  );
  assert.equal(
    timelineTypes().filter((type) => type === "correlation_failed").length,
    1
  );
});

test("L2. claims referencing evidence that was never processed are rejected", async () => {
  seedIncident([
    evidence("ev_captured", {
      status: "captured",
      storage: { status: "preserved", preservedAt: T0, s3Key: "s3://key" },
    }),
  ]);
  await assert.rejects(
    correlateIncidentEvidence(INCIDENT_ID, [
      { evidenceId: "ev_captured", text: "fabricated text for un-processed evidence" },
    ]),
    (error: unknown) =>
      error instanceof PersistenceServiceError && error.code === "EXTRACTION_NOT_AVAILABLE"
  );
});

test("L2-route. claims referencing unknown evidence ids return a 400 with EVIDENCE_NOT_FOUND", async () => {
  seedIncident([evidence("ev_real", { status: "processed" })]);
  const response = await correlateIncidentPost(
    new Request("http://localhost/api/evidence/correlate-incident", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        incidentId: INCIDENT_ID,
        claims: [{ evidenceId: "ev_not_in_incident", text: "injected evidence id" }],
      }),
    })
  );
  const body = (await response.json()) as { ok: boolean; error: { code: string } };
  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "EVIDENCE_NOT_FOUND");
});

test("M2. raw OCR text is never serialized into the persisted/local incident record", () => {
  const snapshot = {
    incident: {
      id: INCIDENT_ID,
      status: "evidence_review",
      type: "upi_fraud",
      amount: null,
      createdAt: T0,
    startedAt: new Date().toISOString(),
      updatedAt: T0,
    },
    evidence: [
      {
        id: "ev_alpha",
        incidentId: INCIDENT_ID,
        filename: "ev_alpha.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        category: "unclassified",
        status: "processed",
        capturedAt: T0,
        extraction: {
          source: "aws-textract",
          extractedAt: T0,
          confidence: 0.92,
          textLength: 25,
          text: "raw OCR content that must never persist",
        },
        text: "raw OCR content that must never persist",
      },
    ],
    timeline: [],
  } as unknown as IncidentWorkspaceSnapshot;

  const record = buildIncidentWorkspaceRecord(snapshot);
  assert.ok(record);
  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes("raw OCR content"), false);
  assert.deepEqual(
    Object.keys((record as { evidence: { extraction?: Record<string, unknown> }[] }).evidence[0].extraction ?? {}).sort(),
    ["confidence", "extractedAt", "source", "textLength"].sort()
  );
});