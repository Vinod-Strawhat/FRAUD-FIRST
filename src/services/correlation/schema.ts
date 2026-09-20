import { CorrelationServiceError } from "./error";
import type {
  ContactPoint,
  CorrelationAnalysis,
  EvidenceDerivedFact,
  EvidenceUrl,
  IdentifierReference,
  MissingInformation,
  TimelineCandidate,
  TimelineCandidateLabel,
  UncertainInformation,
} from "@/types";

const MAX_FACTS = 60;
const MAX_TIMELINE = 60;
const MAX_IDENTIFIERS = 60;
const MAX_CONTACTS = 30;
const MAX_URLS = 30;
const MAX_MISSING = 60;
const MAX_UNCERTAIN = 60;

const REASONABLE_STRING_LIMIT = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampConfidence(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.round(clamped * 1000) / 1000;
}

function toStrings(value: unknown, limitPerItem: number, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (out.length >= maxItems) break;
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed.slice(0, limitPerItem));
  }
  return out;
}

function requiredNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, REASONABLE_STRING_LIMIT);
}

function optionalString(value: unknown, limit: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, limit);
}

function baseSourceEvidenceIds(
  value: unknown,
  evidenceId: string,
  allowedEvidenceIds?: Set<string>
): string[] {
  const ids = toStrings(value, 160, 20);
  const scopedIds = allowedEvidenceIds
    ? ids.filter((id) => allowedEvidenceIds.has(id))
    : ids;
  if (scopedIds.length === 0) return [evidenceId];
  return scopedIds;
}

function parseTimelineLabel(value: unknown): TimelineCandidateLabel | null {
  if (
    value === "CONFIRMED FROM EVIDENCE" ||
    value === "CANDIDATE / UNCERTAIN"
  ) {
    return value;
  }
  return null;
}

function parseConfidence(value: unknown): number | null {
  if (!isFiniteNumber(value)) return null;
  return clampConfidence(value);
}

function parseFacts(
  value: unknown,
  evidenceId: string,
  allowedEvidenceIds?: Set<string>
): EvidenceDerivedFact[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: EvidenceDerivedFact[] = [];
  for (const item of value) {
    if (out.length >= MAX_FACTS) break;
    if (!isRecord(item)) continue;
    const type = requiredNonEmptyString(item.type);
    const rawValue = requiredNonEmptyString(item.value);
    const confidence = parseConfidence(item.confidence);
    if (type === null || rawValue === null || confidence === null) continue;
    out.push({
      type: type.slice(0, 80),
      value: rawValue.slice(0, 512),
      unit: optionalString(item.unit, 32),
      confidence,
      sourceEvidenceIds: baseSourceEvidenceIds(
        item.sourceEvidenceIds,
        evidenceId,
        allowedEvidenceIds
      ),
      sourceText: optionalString(item.sourceText, 600) ?? "",
    });
  }
  return out;
}

function parseTimeline(
  value: unknown,
  evidenceId: string,
  allowedEvidenceIds?: Set<string>
): TimelineCandidate[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: TimelineCandidate[] = [];
  for (const item of value) {
    if (out.length >= MAX_TIMELINE) break;
    if (!isRecord(item)) continue;
    const event = requiredNonEmptyString(item.event);
    const confidence = parseConfidence(item.confidence);
    if (event === null || confidence === null) continue;
    let timestamp: string | null = null;
    if (item.timestamp !== undefined && item.timestamp !== null) {
      if (typeof item.timestamp !== "string") continue;
      const trimmed = item.timestamp.trim();
      timestamp = trimmed.length > 0 ? trimmed.slice(0, 160) : null;
    }
    const label =
      parseTimelineLabel(item.label) ??
      (timestamp ? "CONFIRMED FROM EVIDENCE" : "CANDIDATE / UNCERTAIN");
    out.push({
      timestamp,
      event: event.slice(0, 512),
      sourceEvidenceIds: baseSourceEvidenceIds(
        item.sourceEvidenceIds,
        evidenceId,
        allowedEvidenceIds
      ),
      confidence,
      label,
    });
  }
  return out;
}

function parseIdentifiers(
  value: unknown,
  evidenceId: string,
  allowedEvidenceIds?: Set<string>
): IdentifierReference[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: IdentifierReference[] = [];
  for (const item of value) {
    if (out.length >= MAX_IDENTIFIERS) break;
    if (!isRecord(item)) continue;
    const type = requiredNonEmptyString(item.type);
    const rawValue = requiredNonEmptyString(item.value);
    if (type === null || rawValue === null) continue;
    out.push({
      type: type.slice(0, 64),
      value: rawValue.slice(0, 256),
      sourceEvidenceIds: baseSourceEvidenceIds(
        item.sourceEvidenceIds,
        evidenceId,
        allowedEvidenceIds
      ),
    });
  }
  return out;
}

function parseContacts(
  value: unknown,
  evidenceId: string,
  allowedEvidenceIds?: Set<string>
): ContactPoint[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: ContactPoint[] = [];
  for (const item of value) {
    if (out.length >= MAX_CONTACTS) break;
    if (!isRecord(item)) continue;
    const type = requiredNonEmptyString(item.type);
    const rawValue = requiredNonEmptyString(item.value);
    if (type === null || rawValue === null) continue;
    out.push({
      type: type.slice(0, 64),
      value: rawValue.slice(0, 256),
      sourceEvidenceIds: baseSourceEvidenceIds(
        item.sourceEvidenceIds,
        evidenceId,
        allowedEvidenceIds
      ),
    });
  }
  return out;
}

function parseUrls(
  value: unknown,
  evidenceId: string,
  allowedEvidenceIds?: Set<string>
): EvidenceUrl[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: EvidenceUrl[] = [];
  for (const item of value) {
    if (out.length >= MAX_URLS) break;
    if (!isRecord(item)) continue;
    const rawValue = requiredNonEmptyString(item.value);
    if (rawValue === null) continue;
    out.push({
      value: rawValue.slice(0, 512),
      sourceEvidenceIds: baseSourceEvidenceIds(
        item.sourceEvidenceIds,
        evidenceId,
        allowedEvidenceIds
      ),
    });
  }
  return out;
}

function parseMissing(value: unknown): MissingInformation[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: MissingInformation[] = [];
  for (const item of value) {
    if (out.length >= MAX_MISSING) break;
    if (!isRecord(item)) continue;
    const field = requiredNonEmptyString(item.field);
    const reason = requiredNonEmptyString(item.reason);
    if (field === null || reason === null) continue;
    out.push({
      field: field.slice(0, 128),
      reason: reason.slice(0, 512),
    });
  }
  return out;
}

function parseUncertain(
  value: unknown,
  evidenceId: string,
  allowedEvidenceIds?: Set<string>
): UncertainInformation[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: UncertainInformation[] = [];
  for (const item of value) {
    if (out.length >= MAX_UNCERTAIN) break;
    if (!isRecord(item)) continue;
    const field = requiredNonEmptyString(item.field);
    const reason = requiredNonEmptyString(item.reason);
    if (field === null || reason === null) continue;
    out.push({
      field: field.slice(0, 128),
      reason: reason.slice(0, 512),
      sourceEvidenceIds: baseSourceEvidenceIds(
        item.sourceEvidenceIds,
        evidenceId,
        allowedEvidenceIds
      ),
    });
  }
  return out;
}

export function normalizeCorrelationOutput(
  value: unknown,
  evidenceId: string,
  allowedEvidenceIds?: string[]
): CorrelationAnalysis {
  if (!isRecord(value)) {
    throw new CorrelationServiceError(
      "BEDROCK_INVALID_OUTPUT",
      "The model output was not a structured JSON object."
    );
  }

  const allowed = Array.isArray(allowedEvidenceIds)
    ? new Set(allowedEvidenceIds)
    : undefined;

  const facts = parseFacts(value.facts, evidenceId, allowed);
  const timelineCandidates = parseTimeline(
    value.timelineCandidates,
    evidenceId,
    allowed
  );
  const identifiers = parseIdentifiers(value.identifiers, evidenceId, allowed);
  const contactPoints = parseContacts(value.contactPoints, evidenceId, allowed);
  const urls = parseUrls(value.urls, evidenceId, allowed);
  const missingInformation = parseMissing(value.missingInformation);
  const uncertainInformation = parseUncertain(
    value.uncertainInformation,
    evidenceId,
    allowed
  );

  if (
    facts === null ||
    timelineCandidates === null ||
    identifiers === null ||
    contactPoints === null ||
    urls === null ||
    missingInformation === null ||
    uncertainInformation === null
  ) {
    throw new CorrelationServiceError(
      "BEDROCK_INVALID_OUTPUT",
      "The model output did not match the required structure."
    );
  }

  return {
    facts,
    timelineCandidates,
    identifiers,
    contactPoints,
    urls,
    missingInformation,
    uncertainInformation,
  };
}