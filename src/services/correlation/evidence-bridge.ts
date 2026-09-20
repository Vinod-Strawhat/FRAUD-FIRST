import { createHash } from "node:crypto";

import { getIncident, PersistenceServiceError } from "@/services/incident-persistence";
import { deriveEvidenceReadiness } from "@/services/correlation/readiness";
import { CORRELATION_BATCH_MAX_ITEMS } from "@/services/correlation";
import type {
  CorrelationNotReadyEvidence,
  CorrelationTextClaim,
  EvidenceCategory,
  EvidenceCorrelationReadinessState,
  EvidenceRecord,
  IncidentCorrelationMeta,
  IncidentWorkspaceRecord,
} from "@/types";

/**
 * Server-only bridge between persisted evidence outcomes (Task 4 extraction)
 * and incident correlation (Task 11 orchestration).
 *
 * This module reads the persisted incident record directly, so correlation
 * readiness is re-derived from the source of truth instead of trusting the
 * client. Client-supplied text claims are validated: a claim may only carry
 * usable text for an evidence item that actually belongs to the incident and
 * has genuinely been processed. Unknown or unprocessed evidence ids are
 * rejected rather than silently ignored. The ready provider payload is
 * enriched with source identity (incidentId, category, extraction status) so
 * the model can attribute every fact to the evidence that produced it.
 *
 * This module is server-only: it imports persistence and the AWS-backed
 * correlation service, so it is never bundled for the browser.
 */

export interface CorrelationReadyItem {
  incidentId: string;
  evidenceId: string;
  filename: string;
  mimeType: string;
  category: EvidenceCategory;
  capturedAt: string;
  extractedAt?: string;
  source?: string;
  confidence?: number;
  status: "processed";
  text: string;
}

export interface ReadinessEntry {
  evidenceId: string;
  filename: string;
  mimeType: string;
  capturedAt: string;
  category: EvidenceCategory;
  state: EvidenceCorrelationReadinessState;
  reason: string;
  text?: string;
}

export interface CorrelationReadyEvidenceModel {
  incidentId: string;
  existing?: IncidentCorrelationMeta;
  entries: ReadinessEntry[];
  signature: string;
  evidenceCount: number;
  readyCount: number;
  sourceEvidenceIds: string[];
  notReadyEvidence: CorrelationNotReadyEvidence[];
  readyItems: CorrelationReadyItem[];
}

function readinessSignature(
  incidentId: string,
  evidence: IncidentWorkspaceRecord["evidence"],
  claims: Map<string, CorrelationTextClaim>
): string {
  const sha = createHash("sha256");
  sha.update(incidentId);
  for (const record of evidence) {
    const claim = claims.get(record.id);
    sha.update(record.id);
    sha.update(record.status);
    sha.update(record.mimeType);
    sha.update(record.category);
    sha.update(record.storage?.status ?? "not_preserved");
    sha.update(record.extraction?.source ?? "");
    sha.update(record.extraction?.extractedAt ?? "");
    sha.update(String(record.extraction?.textLength ?? ""));
    sha.update(claim ? claim.text : "no-claim");
    sha.update(claim?.source ?? "");
    sha.update(claim?.extractedAt ?? "");
  }
  return sha.digest("hex");
}

function deriveReadinessEntries(
  record: IncidentWorkspaceRecord,
  claims: Map<string, CorrelationTextClaim>
): ReadinessEntry[] {
  const entries: ReadinessEntry[] = [];
  for (const evidence of record.evidence) {
    const claim = claims.get(evidence.id);
    const readiness = deriveEvidenceReadiness(evidence, claim);
    entries.push({
      evidenceId: evidence.id,
      filename: evidence.filename,
      mimeType: evidence.mimeType,
      capturedAt: evidence.capturedAt,
      category: evidence.category,
      state: readiness.state,
      reason: readiness.reason,
      text: readiness.text,
    });
  }
  return entries;
}

/**
 * Load an incident and produce the model of which evidence is genuinely
 * correlation-ready. Rejects claims that reference an evidence id outside
 * the incident or that reference evidence that was never processed.
 */
export async function getCorrelationReadyEvidence(
  incidentId: string,
  claims: CorrelationTextClaim[] = []
): Promise<CorrelationReadyEvidenceModel> {
  const record = await getIncident(incidentId);
  if (!record) {
    throw new PersistenceServiceError(
      "INCIDENT_NOT_FOUND",
      "No incident exists with this id."
    );
  }

  const evidenceById = new Map<string, EvidenceRecord>(
    record.evidence.map((entry) => [entry.id, entry])
  );
  const claimsById = new Map<string, CorrelationTextClaim>();
  for (const claim of claims) {
    if (
      typeof claim?.evidenceId !== "string" ||
      typeof claim?.text !== "string"
    ) {
      continue;
    }
    const target = evidenceById.get(claim.evidenceId);
    if (!target) {
      throw new PersistenceServiceError(
        "EVIDENCE_NOT_FOUND",
        "A text claim references an evidence item that is not part of this incident."
      );
    }
    if (target.status !== "processed") {
      throw new PersistenceServiceError(
        "EXTRACTION_NOT_AVAILABLE",
        "A text claim references an evidence item that has not been processed."
      );
    }
    claimsById.set(claim.evidenceId, claim);
  }

  const entries = deriveReadinessEntries(record, claimsById);
  const signature = readinessSignature(incidentId, record.evidence, claimsById);

  const readyEntries = entries.filter((entry) => entry.state === "ready");
  if (readyEntries.length > CORRELATION_BATCH_MAX_ITEMS) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "Too many ready evidence items for a single correlation run."
    );
  }

  const readyItems: CorrelationReadyItem[] = readyEntries.map((entry) => {
    const claim = claimsById.get(entry.evidenceId);
    return {
      incidentId,
      evidenceId: entry.evidenceId,
      filename: entry.filename,
      mimeType: entry.mimeType,
      category: entry.category,
      capturedAt: entry.capturedAt,
      extractedAt: claim?.extractedAt,
      source: claim?.source,
      confidence: claim?.confidence,
      status: "processed",
      text: entry.text ?? "",
    };
  });

  const notReadyEvidence: CorrelationNotReadyEvidence[] = entries
    .filter((entry) => entry.state !== "ready")
    .map((entry) => ({
      evidenceId: entry.evidenceId,
      filename: entry.filename,
      state: entry.state,
      reason: entry.reason,
    }));

  return {
    incidentId,
    existing: record.correlation,
    entries,
    signature,
    evidenceCount: entries.length,
    readyCount: readyEntries.length,
    sourceEvidenceIds: readyEntries.map((entry) => entry.evidenceId),
    notReadyEvidence,
    readyItems,
  };
}