import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { PDFDocument } from "pdf-lib";

import {
  buildIncidentPackage,
  PackageServiceError,
  PACKAGE_NOT_READY_NO_EVIDENCE_MESSAGE,
  PACKAGE_NOT_READY_NOT_PRESERVED_MESSAGE,
} from "../src/services/package/builder";
import {
  buildPdfTextContent,
  isSafePackageFilename,
  packagePdfFilename,
  PACKAGE_PDF_SECTION_HEADINGS,
  PACKAGE_PDF_TITLE_LINE,
  renderIncidentPackagePdf,
  sanitizePdfText,
} from "../src/services/package/pdf";
import { GET as packageGet } from "../src/app/api/incidents/[id]/package/route";
import { GET as packageDownloadGet } from "../src/app/api/incidents/[id]/package/download/route";
import { INTELLIGENCE_CORRELATION_FAILED_MESSAGE } from "../src/types/intelligence";
import type {
  CorrelationAnalysis,
  EvidenceRecord,
  IncidentCorrelationMeta,
  IncidentPackageMeta,
  IncidentPackageReady,
  IncidentPackageResult,
  IncidentResponseMeta,
} from "../src/types";
import { INCIDENT_PACKAGE_DISCLAIMER } from "../src/types/package";

const INCIDENT_ID = "FF-20260920-ABCD";
const T0 = "2026-09-20T10:00:00.000Z";
const T1 = "2026-09-20T10:05:00.000Z";
const HASH = "abc123".repeat(11);
const EXECUTION_ARN =
  "arn:aws:states:us-east-1:123456789012:execution:fraudfirst-response:abcdef";

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

function preservedOne(
  overrides: Partial<EvidenceRecord> = {}
): EvidenceRecord {
  return evidence("ev_one", {
    status: "processed",
    extraction: { source: "aws-textract", extractedAt: T0, textLength: 25 },
    storage: {
      status: "preserved",
      preservedAt: T0,
      sha256: HASH,
      s3Key: "incidents/FF-20260920-ABCD/evidence/ev_one/original",
      bucket: "fraudfirst-evidence",
      contentType: "image/jpeg",
      byteSize: 1024,
    },
    ...overrides,
  });
}

function unpreserved(): EvidenceRecord {
  return evidence("ev_two", {
    status: "captured",
    storage: { status: "not_preserved" },
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
        timestamp: T1,
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

function failedMeta(): IncidentCorrelationMeta {
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
    analysis: corpusAnalysis(["ev_one"]),
  };
}

const RESPONSE_ACTIONS = [
  { id: "resp_preserve_evidence", type: "preserve_evidence" as const, status: "completed" as const, order: 1, createdAt: T0, completedAt: T1 },
  { id: "resp_contact_bank", type: "contact_bank" as const, status: "pending" as const, order: 2, createdAt: T0 },
  { id: "resp_contact_1930", type: "contact_1930" as const, status: "pending" as const, order: 3, createdAt: T0 },
  { id: "resp_report_cybercrime", type: "report_cybercrime" as const, status: "pending" as const, order: 4, createdAt: T0 },
  { id: "resp_follow_up", type: "follow_up" as const, status: "pending" as const, order: 5, createdAt: T0 },
];

function responseMeta(overrides: Partial<IncidentResponseMeta> = {}): IncidentResponseMeta {
  return {
    status: "running",
    startedAt: T0,
    updatedAt: T1,
    currentActionType: "contact_bank",
    executionArn: EXECUTION_ARN,
    actions: [...RESPONSE_ACTIONS],
    ...overrides,
  };
}

function completedResponseMeta(): IncidentResponseMeta {
  return responseMeta({
    status: "completed",
    currentActionType: null,
    actions: RESPONSE_ACTIONS.map((action) => ({
      ...action,
      status: "completed",
      completedAt: T1,
    })),
  });
}

function seedIncident(
  evidenceList: EvidenceRecord[],
  opts: {
    correlation?: IncidentCorrelationMeta;
    response?: IncidentResponseMeta;
    updatedAt?: string;
    extra?: Record<string, unknown>;
  } = {}
): void {
  const base: Record<string, unknown> = {
    schemaVersion: 1,
    incidentId: INCIDENT_ID,
    status: "evidence_review",
    type: "upi_fraud",
    amount: "24500",
    createdAt: T0,
    startedAt: T0,
    updatedAt: opts.updatedAt ?? T1,
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
  if (opts.correlation) base.correlation = opts.correlation;
  if (opts.response) base.response = opts.response;
  if (opts.extra) {
    Object.assign(base, opts.extra);
  }
  store.set(INCIDENT_ID, base);
}

function asReady(result: IncidentPackageResult): IncidentPackageReady {
  assert.equal(result.status, "ready", "expected a ready package result");
  return result as IncidentPackageReady;
}

async function readyPackage(): Promise<IncidentPackageMeta> {
  const result = await buildIncidentPackage(INCIDENT_ID);
  return asReady(result).package;
}

// A. Invalid incident id fails hard before any storage access.
test("A: invalid incident id is rejected", async () => {
  await assert.rejects(
    buildIncidentPackage("../../etc/passwd"),
    (error: unknown) => {
      assert.ok(error instanceof PackageServiceError);
      assert.equal(error.code, "INVALID_INCIDENT");
      return true;
    }
  );
  await assert.rejects(
    buildIncidentPackage("not-an-incident"),
    (error: unknown) => {
      assert.ok(error instanceof PackageServiceError);
      assert.equal(error.code, "INVALID_INCIDENT");
      return true;
    }
  );
  assert.equal(calls.length, 0);
});

// B. Missing incident returns a hard error (never a fabricated package).
test("B: missing incident is not fabricated", async () => {
  await assert.rejects(
    buildIncidentPackage(INCIDENT_ID),
    (error: unknown) => {
      assert.ok(error instanceof PackageServiceError);
      assert.equal(error.code, "INCIDENT_NOT_FOUND");
      return true;
    }
  );
});

// C. No evidence -> explicit not_ready with the exact message.
test("C: no evidence means pkg not ready", async () => {
  seedIncident([]);
  const outcome = await buildIncidentPackage(INCIDENT_ID);
  if (outcome.status !== "not_ready") {
    assert.fail("expected not_ready");
  }
  assert.equal(outcome.reason, "no_evidence");
  assert.equal(outcome.message, PACKAGE_NOT_READY_NO_EVIDENCE_MESSAGE);
});

// D. Evidence present but nothing preserved -> explicit not_preserved state.
test("D: nothing preserved means pkg not ready", async () => {
  seedIncident([unpreserved()]);
  const outcome = await buildIncidentPackage(INCIDENT_ID);
  if (outcome.status !== "not_ready") {
    assert.fail("expected not_ready");
  }
  assert.equal(outcome.reason, "not_preserved");
  assert.equal(outcome.message, PACKAGE_NOT_READY_NOT_PRESERVED_MESSAGE);
});

// E. Mixed preserved + unpreserved: every entry is reported accurately.
test("E: mixed evidence reported accurately", async () => {
  seedIncident([preservedOne(), unpreserved()], {
    correlation: correlatedMeta(["ev_one"]),
  });
  const pkg = await readyPackage();
  assert.equal(pkg.evidenceIndex.length, 2);
  const preserved = pkg.evidenceIndex.find((e) => e.evidenceId === "ev_one");
  const pending = pkg.evidenceIndex.find((e) => e.evidenceId === "ev_two");
  assert.ok(preserved && pending);
  assert.equal(preserved.preserved, true);
  assert.equal(preserved.storageStatus, "preserved");
  assert.equal(pending.preserved, false);
  assert.equal(pending.storageStatus, "not_preserved");
  assert.equal(pending.sha256, undefined);
  assert.equal(pending.storageReference, undefined);
  assert.equal(pkg.integrity.preservedCount, 1);
  assert.equal(pkg.integrity.unpreservedCount, 1);
});

// F. SHA-256 is copied exactly from the persistence record, never recomputed.
test("F: sha256 copied exactly from the persisted preservation record", async () => {
  seedIncident([preservedOne()], { correlation: correlatedMeta(["ev_one"]) });
  const pkg = await readyPackage();
  const entry = pkg.evidenceIndex.find((e) => e.evidenceId === "ev_one");
  assert.equal(entry?.sha256, HASH);
  assert.equal(pkg.integrity.hashesIncluded, true);
});

// G. Evidence index lists the persisted evidence ids exactly, no duplicates.
test("G: evidence ids in the index are exact", async () => {
  const list = [preservedOne(), evidence("ev_three", { storage: undefined })];
  seedIncident(list, { correlation: correlatedMeta(["ev_one"]) });
  const pkg = await readyPackage();
  const ids = pkg.evidenceIndex.map((e) => e.evidenceId);
  assert.deepEqual(ids, ["ev_one", "ev_three"]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(pkg.evidenceIndex.length, list.length);
});

// H. No hashes are ever invented: absent sha256 is reflected honestly.
test("H: never fabricates a hash", async () => {
  const withoutHash = preservedOne({
    storage: {
      status: "preserved",
      preservedAt: T0,
      s3Key: "incidents/FF-20260920-ABCD/evidence/ev_one/original",
    },
  });
  seedIncident([withoutHash], { correlation: correlatedMeta(["ev_one"]) });
  const pkg = await readyPackage();
  const entry = pkg.evidenceIndex.find((e) => e.evidenceId === "ev_one");
  assert.equal(entry?.sha256, undefined);
  assert.equal(pkg.integrity.hashesIncluded, false);
  assert.equal(pkg.integrity.preservedOriginalsReferenced, true);
});

// I. Ready intelligence brief is embedded with facts intact (incl. sourceEvidenceIds).
test("I: ready intelligence brief is embedded faithfully", async () => {
  seedIncident([preservedOne()], { correlation: correlatedMeta(["ev_one"]) });
  const pkg = await readyPackage();
  assert.equal(pkg.intelligence.available, true);
  assert.equal(pkg.intelligence.status, "ready");
  const brief = pkg.intelligence.brief;
  assert.ok(brief);
  assert.equal(brief.incidentId, INCIDENT_ID);
  assert.equal(brief.summary.length > 0, true);
  assert.equal(brief.generatedAt, T1);
  assert.equal(brief.facts[0].sourceEvidenceIds[0], "ev_one");
  assert.deepEqual(brief.sourceEvidenceIds, ["ev_one"]);
});

// J. Intelligence not ready: package records the real state, never substitutes.
test("J: unavailable intelligence is recorded, not substituted", async () => {
  seedIncident([preservedOne()]);
  const pkg = await readyPackage();
  assert.equal(pkg.intelligence.available, false);
  assert.equal(pkg.intelligence.status, "not_ready");
  assert.equal(pkg.intelligence.reason, "correlation_pending");
  assert.equal(pkg.intelligence.brief, undefined);
  assert.equal(typeof pkg.intelligence.message === "string", true);
});

// K. Failed intelligence: package reflects failure and does not reuse old brief as current.
test("K: failed intelligence is recorded with its reason", async () => {
  seedIncident([preservedOne()], { correlation: failedMeta() });
  const pkg = await readyPackage();
  assert.equal(pkg.intelligence.available, false);
  assert.equal(pkg.intelligence.status, "failed");
  assert.equal(pkg.intelligence.message, INTELLIGENCE_CORRELATION_FAILED_MESSAGE);
  assert.equal(pkg.intelligence.brief, undefined);
});

// L. Missing information from the brief is carried through.
test("L: missing information is preserved in the package", async () => {
  seedIncident([preservedOne()], { correlation: correlatedMeta(["ev_one"]) });
  const pkg = await readyPackage();
  assert.deepEqual(pkg.intelligence.brief?.missingInformation, [
    { field: "fraudster_name", reason: "not present in evidence" },
  ]);
});

// M. Uncertain information from the brief is carried through.
test("M: uncertain information is preserved in the package", async () => {
  seedIncident([preservedOne()], { correlation: correlatedMeta(["ev_one"]) });
  const pkg = await readyPackage();
  assert.deepEqual(pkg.intelligence.brief?.uncertainInformation, [
    {
      field: "transaction_time",
      reason: "timestamp not readable",
      sourceEvidenceIds: ["ev_one"],
    },
  ]);
});

// N. Response state is projected accurately from the persisted plan.
test("N: response state is accurate", async () => {
  seedIncident([preservedOne()], {
    correlation: correlatedMeta(["ev_one"]),
    response: responseMeta(),
  });
  const pkg = await readyPackage();
  assert.equal(pkg.response.started, true);
  assert.equal(pkg.response.status, "running");
  assert.equal(pkg.response.startedAt, T0);
  assert.equal(pkg.response.updatedAt, T1);
  assert.equal(pkg.response.actions.length, 5);
  assert.equal(pkg.response.actions[0].title, "Preserve evidence");
  assert.equal(pkg.response.actions[0].status, "completed");
  assert.equal(pkg.response.actions[0].completedAt, T1);
  assert.equal(pkg.response.actions[1].title, "Contact the bank or payment provider");
  assert.deepEqual(
    pkg.response.actions.map((a) => a.type),
    ["preserve_evidence", "contact_bank", "contact_1930", "report_cybercrime", "follow_up"]
  );
});

// O. Live execution status appears only when a persisted execution is recorded.
test("O: live execution status only when a live execution exists", async () => {
  seedIncident([preservedOne()], {
    correlation: correlatedMeta(["ev_one"]),
    response: responseMeta(),
  });
  const live = await readyPackage();
  assert.equal(live.response.liveExecution, true);
  assert.equal(live.response.executionStatus, "RUNNING");

  seedIncident([preservedOne()], {
    correlation: correlatedMeta(["ev_one"]),
    response: responseMeta({ executionArn: undefined }),
  });
  const withoutArn = await readyPackage();
  assert.equal(withoutArn.response.liveExecution, false);
  assert.equal(withoutArn.response.executionStatus, undefined);

  seedIncident([preservedOne()], {
    correlation: correlatedMeta(["ev_one"]),
    response: completedResponseMeta(),
  });
  const completed = await readyPackage();
  assert.equal(completed.response.executionStatus, "COMPLETED");
});

// P. Never expose task tokens or the execution ARN in the packaged output.
test("P: task tokens and ARNs never leak into the package", async () => {
  store.set(`sf-token-${INCIDENT_ID}`, {
    taskToken: "super-secret-task-token-abcdef",
    incidentId: INCIDENT_ID,
  } as unknown as Record<string, unknown>);
  seedIncident([preservedOne()], {
    correlation: correlatedMeta(["ev_one"]),
    response: responseMeta(),
  });
  const pkg = await readyPackage();
  const serialized = JSON.stringify(pkg);
  assert.equal(serialized.includes("taskToken"), false);
  assert.equal(serialized.includes("task-token"), false);
  assert.equal(serialized.includes(EXECUTION_ARN), false);
  assert.equal(serialized.includes("arn:aws"), false);
  assert.equal(serialized.includes("super-secret-task-token"), false);
  assert.equal("executionArn" in pkg.response, false);
});

// Q. Malicious client-shaped content can never execute: it stays data.
test("Q: hostile text is kept as data, not markup or code", async () => {
  const hostile = preservedOne({
    filename: '<script>alert("xss")</script>',
  });
  seedIncident([hostile], { correlation: correlatedMeta(["ev_one"]) });
  const pkg = await readyPackage();
  const entry = pkg.evidenceIndex.find((e) => e.evidenceId === "ev_one");
  assert.equal(
    entry?.originalFilename,
    '<script>alert("xss")</script>',
    "the honest value is retained for the structured record"
  );
  const json = JSON.stringify(pkg);
  assert.equal(json.includes("<html"), false);
  const joined = buildPdfTextContent(pkg)
    .map((line) => line.text)
    .join("\n");
  assert.equal(joined.includes('<script>alert("xss")</script>'), true);
});

// R. Determinism: generatedAt is the persisted updatedAt; repeated builds are identical.
test("R: packages are deterministic and timestamped from persisted data", async () => {
  seedIncident([preservedOne()], { correlation: correlatedMeta(["ev_one"]) });
  const first = await readyPackage();
  const second = await readyPackage();
  assert.equal(first.generatedAt, T1);
  assert.equal(second.generatedAt, T1);
  assert.deepEqual(first, second);
  assert.equal(calls.filter((c) => c.commandName === "PutCommand").length, 0);
});

// S. Concurrent generation is safe and cannot double-write.
test("S: concurrent generation is deterministic and read-only", async () => {
  seedIncident([preservedOne()], { correlation: correlatedMeta(["ev_one"]) });
  const [a, b] = await Promise.all([
    buildIncidentPackage(INCIDENT_ID),
    buildIncidentPackage(INCIDENT_ID),
  ]);
  assert.deepEqual(asReady(a).package, asReady(b).package);
  const snapshot = JSON.stringify(store.get(INCIDENT_ID));
  assert.equal(calls.filter((c) => c.commandName === "PutCommand").length, 0);
  assert.equal(JSON.stringify(store.get(INCIDENT_ID)), snapshot);
});

// T. Filename policy: safe filenames only, derived from the validated id.
test("T: content-disposition filename is derived safely", async () => {
  const name = packagePdfFilename(INCIDENT_ID);
  assert.equal(name, "FraudFirst-FF-20260920-ABCD-Incident-Package.pdf");
  assert.equal(isSafePackageFilename(name), true);
  assert.equal(isSafePackageFilename("').foo|../../x.pdf"), false);
  assert.equal(isSafePackageFilename("FraudFirst-foo.pdf"), false);
  assert.equal(isSafePackageFilename("FraudFirst-FF-99999999-ABCD-Incident-Package.pdf"), true);

  seedIncident([preservedOne()], { correlation: correlatedMeta(["ev_one"]) });
  const response = await packageDownloadGet(
    new Request(`http://localhost/api/incidents/${INCIDENT_ID}/package/download`),
    { params: Promise.resolve({ id: INCIDENT_ID }) } as never
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="FraudFirst-FF-20260920-ABCD-Incident-Package.pdf"'
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
});

// U. The PDF is a valid, non-trivial, loadable document.
test("U: rendered package is a valid PDF", async () => {
  seedIncident([preservedOne()], { correlation: correlatedMeta(["ev_one"]) });
  const pkg = await readyPackage();
  const bytes = await renderIncidentPackagePdf(pkg);
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.length > 1000);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("latin1"), "%PDF-");
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 1);
  assert.equal(doc.getTitle(), `FraudFirst Incident Package - ${INCIDENT_ID}`);
});

// V. Every conceptual section is rendered exactly once, in order.
test("V: the package PDF renders all 12 sections in order", async () => {
  seedIncident([preservedOne()], {
    correlation: correlatedMeta(["ev_one"]),
    response: responseMeta(),
  });
  const pkg = await readyPackage();
  const lines = buildPdfTextContent(pkg);
  assert.equal(lines[0].text, PACKAGE_PDF_TITLE_LINE);
  const headings = lines
    .filter((line) => line.kind === "heading")
    .map((line) => line.text);
  assert.deepEqual(headings, PACKAGE_PDF_SECTION_HEADINGS);
  assert.equal(headings.length, 12);
  for (const heading of PACKAGE_PDF_SECTION_HEADINGS) {
    assert.equal(
      headings.filter((h) => h === heading).length,
      1,
      `${heading} rendered exactly once`
    );
  }
  assert.equal(pkg.disclaimer, INCIDENT_PACKAGE_DISCLAIMER);
});

// W. Secrets never enter the document (asserted at the only content source).
test("W: no secrets or credentials enter the PDF content", async () => {
  seedIncident([preservedOne()], { correlation: correlatedMeta(["ev_one"]) });
  const pkg = await readyPackage();
  const joined = buildPdfTextContent(pkg)
    .map((line) => line.text)
    .join("\n");
  assert.equal(joined.includes("test-secret"), false);
  assert.equal(joined.includes("AWS_ACCESS_KEY_ID"), false);
  assert.equal(joined.includes("AWS_SECRET_ACCESS_KEY"), false);
  assert.equal(joined.includes("AKIA"), false);
  assert.equal(JSON.stringify(pkg).includes("test-secret"), false);
});

// X. Raw OCR text never resurfaces through the package or the PDF.
test("X: raw OCR text is never exposed", async () => {
  seedIncident([preservedOne()], { correlation: correlatedMeta(["ev_one"]) });
  const pkg = await readyPackage();
  const serialized = JSON.stringify(pkg);
  assert.equal(serialized.includes("raw OCR content that must never surface"), false);
  assert.equal(serialized.includes("sourceText"), false);
  const joined = buildPdfTextContent(pkg)
    .map((line) => line.text)
    .join("\n");
  assert.equal(joined.includes("raw OCR content that must never surface"), false);
});

// Y. Control characters and shell-escape sequences are stripped for rendering.
test("Y: render-safe text sanitisation", async () => {
  const hostileBytes = preservedOne({
    filename: "weird\x00name\x1b[31m.jpg",
  });
  seedIncident([hostileBytes], { correlation: correlatedMeta(["ev_one"]) });
  const pkg = await readyPackage();
  assert.equal(
    pkg.evidenceIndex.find((e) => e.evidenceId === "ev_one")?.originalFilename,
    "weird\x00name\x1b[31m.jpg"
  );
  const joined = buildPdfTextContent(pkg)
    .map((line) => line.text)
    .join("\n");
  assert.equal(joined.includes("\x00"), false);
  assert.equal(joined.includes("\x1b"), false);
  const lines = buildPdfTextContent(pkg).map((line) => line.text);
  for (const line of lines) {
    assert.equal(line, sanitizePdfText(line));
  }
});

// Z. The API responses are well-formed end to end.
test("Z: package and download routes are well-formed", async () => {
  seedIncident([preservedOne()], { correlation: correlatedMeta(["ev_one"]) });

  const ok = await packageGet(
    new Request(`http://localhost/api/incidents/${INCIDENT_ID}/package`),
    { params: Promise.resolve({ id: INCIDENT_ID }) } as never
  );
  assert.equal(ok.status, 200);
  const okBody = (await ok.json()) as {
    ok: boolean;
    result: IncidentPackageResult;
  };
  assert.equal(okBody.ok, true);
  assert.equal(okBody.result.status, "ready");

  const bad = await packageGet(
    new Request(`http://localhost/api/incidents/bad/package`),
    { params: Promise.resolve({ id: "bad" }) } as never
  );
  assert.equal(bad.status, 400);
  const badBody = (await bad.json()) as { ok: boolean; error: { code: string } };
  assert.equal(badBody.ok, false);
  assert.equal(badBody.error.code, "INVALID_INCIDENT");

  seedIncident([]);
  const notReady = await packageGet(
    new Request(`http://localhost/api/incidents/${INCIDENT_ID}/package`),
    { params: Promise.resolve({ id: INCIDENT_ID }) } as never
  );
  assert.equal(notReady.status, 200);
  const notReadyBody = (await notReady.json()) as {
    ok: boolean;
    result: IncidentPackageResult;
  };
  assert.equal(notReadyBody.result.status, "not_ready");

  const conflict = await packageDownloadGet(
    new Request(`http://localhost/api/incidents/${INCIDENT_ID}/package/download`),
    { params: Promise.resolve({ id: INCIDENT_ID }) } as never
  );
  assert.equal(conflict.status, 409);
  const conflictBody = (await conflict.json()) as { ok: boolean; code: string };
  assert.equal(conflictBody.ok, false);
  assert.equal(conflictBody.code, "PACKAGE_NOT_READY");
});

test("service reads remain read-only after several builds", async () => {
  seedIncident([preservedOne()], { correlation: correlatedMeta(["ev_one"]) });
  await buildIncidentPackage(INCIDENT_ID);
  await buildIncidentPackage(INCIDENT_ID);
  const buildCalls = calls.filter((c) => c.commandName === "PutCommand");
  assert.equal(buildCalls.length, 0);
});