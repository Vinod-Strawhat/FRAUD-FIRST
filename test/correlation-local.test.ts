import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { correlateLocally } from "../src/services/correlation/local";
import { correlateEvidenceBatch } from "../src/services/correlation";
import { correlateEvidenceWithFallback } from "../src/services/providers/correlate";
import type { CorrelationAnalysis } from "../src/types";

const INCIDENT_ID = "FF-20260920-ABCD";

const ENV_KEYS = [
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_PROFILE",
  "FRAUDFIRST_BEDROCK_MODEL_ID",
  "OPENROUTER_API_KEY",
  "FRAUDFIRST_OPENROUTER_MODEL_ID",
] as const;

const savedEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]] as const)
);

before(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

after(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function item(evidenceId: string, text: string) {
  return {
    incidentId: INCIDENT_ID,
    evidenceId,
    filename: `${evidenceId}.jpg`,
    mimeType: "image/jpeg",
    category: "unclassified",
    status: "processed" as const,
    text,
  };
}

function upiIds(analysis: CorrelationAnalysis): string[] | undefined {
  const entry = analysis.identifiers.find(
    (identifier) => identifier.type === "upi_id"
  );
  return entry?.sourceEvidenceIds;
}

const EVIDENCE_A =
  "Paid Rs. 24,500 to xyz@okhdfc on 20/09/2026 at 6:42 PM. " +
  "UTR 334455667788. Sender phone +91 9876543210.";
const EVIDENCE_B =
  "Received Rs. 24500 same transaction. Ref No 334455667788. " +
  "UPI xyz@okhdfc. Callback 9876543210. 2026-09-20.";

test("two evidence records produce a deterministic cross-evidence correlation", () => {
  const result = correlateLocally([
    item("ev_a", EVIDENCE_A),
    item("ev_b", EVIDENCE_B),
  ]);

  assert.equal(result.modelId, "local-deterministic-v1");
  assert.equal(result.textLength, EVIDENCE_A.length + EVIDENCE_B.length);

  const analysis = result.analysis;

  const amount = analysis.facts.find(
    (fact) => fact.type === "transaction_amount" && fact.value === "24500"
  );
  assert.ok(amount);
  assert.equal(amount.unit, "INR");
  assert.deepEqual(amount.sourceEvidenceIds, ["ev_a", "ev_b"]);

  const utr = analysis.identifiers.find(
    (identifier) => identifier.type === "utr"
  );
  assert.ok(utr);
  assert.equal(utr.value, "334455667788");
  assert.deepEqual(utr.sourceEvidenceIds, ["ev_a", "ev_b"]);

  const upi = analysis.identifiers.find(
    (identifier) => identifier.type === "upi_id"
  );
  assert.ok(upi);
  assert.equal(upi.value, "xyz@okhdfc");
  assert.deepEqual(upi.sourceEvidenceIds, ["ev_a", "ev_b"]);

  const phone = analysis.contactPoints.find(
    (contact) => contact.type === "phone"
  );
  assert.ok(phone);
  assert.equal(phone.value, "9876543210");
  assert.deepEqual(phone.sourceEvidenceIds, ["ev_a", "ev_b"]);
});

test("cross-evidence dates collapse into one traceable timeline candidate", () => {
  const analysis = correlateLocally([
    item("ev_a", EVIDENCE_A),
    item("ev_b", EVIDENCE_B),
  ]).analysis;

  assert.equal(analysis.timelineCandidates.length, 1);
  const candidate = analysis.timelineCandidates[0];
  assert.equal(candidate.label, "CONFIRMED FROM EVIDENCE");
  assert.equal(candidate.timestamp, "2026-09-20T18:42:00");
  assert.deepEqual(candidate.sourceEvidenceIds, ["ev_a", "ev_b"]);
});

test("local correlation is deterministic and never hallucinates evidence ids", () => {
  const first = correlateLocally([item("ev_a", EVIDENCE_A), item("ev_b", EVIDENCE_B)]);
  const second = correlateLocally([item("ev_a", EVIDENCE_A), item("ev_b", EVIDENCE_B)]);

  assert.deepEqual(first.analysis, second.analysis);
  assert.equal(first.modelId, second.modelId);

  assert.deepEqual(upiIds(first.analysis), ["ev_a", "ev_b"]);
  const allowed = new Set(["ev_a", "ev_b"]);
  const referenced = [
    ...first.analysis.facts.flatMap((fact) => fact.sourceEvidenceIds),
    ...first.analysis.identifiers.flatMap((identifier) => identifier.sourceEvidenceIds),
    ...first.analysis.contactPoints.flatMap((contact) => contact.sourceEvidenceIds),
    ...first.analysis.urls.flatMap((url) => url.sourceEvidenceIds),
    ...first.analysis.timelineCandidates.flatMap((entry) => entry.sourceEvidenceIds),
  ];
  assert.ok(referenced.length > 0);
  for (const id of referenced) assert.ok(allowed.has(id));
});

test("distinct identifiers across evidence are kept separate (no false merges)", () => {
  const analysis = correlateLocally([
    item("ev_x", "Paid Rs. 100. UTR 1111111111."),
    item("ev_y", "Paid Rs. 200. UTR 2222222222."),
  ]).analysis;

  const amounts = analysis.facts
    .filter((fact) => fact.type === "transaction_amount")
    .map((fact) => fact.value)
    .sort();
  assert.deepEqual(amounts, ["100", "200"]);

  assert.equal(analysis.identifiers.length, 2);
  const utrs = analysis.identifiers
    .filter((identifier) => identifier.type === "utr")
    .map((identifier) => identifier.value)
    .sort();
  assert.deepEqual(utrs, ["1111111111", "2222222222"]);
  for (const identifier of analysis.identifiers) {
    assert.deepEqual(identifier.sourceEvidenceIds.length, 1);
  }
});

test("provider fallback honestly reports local+fallback when no cloud provider is configured", async () => {
  const result = await correlateEvidenceWithFallback([
    item("ev_a", EVIDENCE_A),
    item("ev_b", EVIDENCE_B),
  ]);

  assert.equal(result.provider, "local");
  assert.equal(result.providerMode, "fallback");
  assert.equal(result.modelId, "local-deterministic-v1");
  assert.equal((upiIds(result.analysis) ?? []).length, 2);
});

test("the correlation service surface surfaces honest local+fallback metadata", async () => {
  const result = await correlateEvidenceBatch([item("ev_a", EVIDENCE_A)]);

  assert.equal(result.provider, "local");
  assert.equal(result.providerMode, "fallback");
  assert.equal(result.modelId, "local-deterministic-v1");
  assert.ok(result.analysis.facts.length >= 1);
});