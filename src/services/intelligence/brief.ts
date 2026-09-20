import { getIncident, PersistenceServiceError } from "@/services/incident-persistence";
import { INCIDENT_TYPE_LABELS } from "@/types/incident";
import type {
  ContactPoint,
  EvidenceDerivedFact,
  EvidenceUrl,
  IdentifierReference,
  IncidentCorrelationMeta,
  IncidentIntelligenceFact,
  IncidentWorkspaceRecord,
  MissingInformation,
  TimelineCandidate,
  UncertainInformation,
} from "@/types";
import {
  INTELLIGENCE_CORRELATION_FAILED_MESSAGE,
  INTELLIGENCE_CORRELATION_PENDING_MESSAGE,
  INTELLIGENCE_EXTRACTION_UNAVAILABLE_MESSAGE,
  INTELLIGENCE_NO_EVIDENCE_MESSAGE,
  INTELLIGENCE_NOT_PRESERVED_MESSAGE,
} from "@/types/intelligence";
import type {
  IncidentIntelligence,
  IncidentIntelligenceBrief,
} from "@/types/intelligence";

const FINANCIAL_FACT_TYPE_KEYWORDS: readonly string[] = [
  "transaction",
  "upi",
  "payment",
  "amount",
  "transfer",
  "account",
  "card",
  "wallet",
  "bank",
  "reference",
  "receipt",
  "netbanking",
  "imps",
  "neft",
  "rtgs",
];

function isFinancialFactType(type: string): boolean {
  const normalized = type.toLowerCase();
  return FINANCIAL_FACT_TYPE_KEYWORDS.some((keyword) =>
    normalized.includes(keyword)
  );
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function filterToAllowed(ids: string[], allowed: Set<string>): string[] {
  return uniqueIds(ids.filter((id) => allowed.has(id)));
}

function dedupe<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function scopedFact(
  fact: EvidenceDerivedFact,
  allowed: Set<string>
): IncidentIntelligenceFact | null {
  const sourceEvidenceIds = filterToAllowed(fact.sourceEvidenceIds, allowed);
  if (sourceEvidenceIds.length === 0) return null;
  const { sourceText: _sourceText, ...rest } = fact;
  void _sourceText;
  return { ...rest, sourceEvidenceIds };
}

function scopedTimeline(
  entry: TimelineCandidate,
  allowed: Set<string>
): TimelineCandidate | null {
  const sourceEvidenceIds = filterToAllowed(entry.sourceEvidenceIds, allowed);
  if (sourceEvidenceIds.length === 0) return null;
  return { ...entry, sourceEvidenceIds };
}

function scopedIdentifiers(
  entries: IdentifierReference[],
  allowed: Set<string>
): IdentifierReference[] {
  return dedupe(
    entries
      .map((entry) => {
        const sourceEvidenceIds = filterToAllowed(
          entry.sourceEvidenceIds,
          allowed
        );
        if (sourceEvidenceIds.length === 0) return null;
        return { ...entry, sourceEvidenceIds };
      })
      .filter((entry): entry is IdentifierReference => entry !== null),
    (entry) => `${entry.type}|${entry.value}`
  );
}

function scopedContacts(
  entries: ContactPoint[],
  allowed: Set<string>
): ContactPoint[] {
  return dedupe(
    entries
      .map((entry) => {
        const sourceEvidenceIds = filterToAllowed(
          entry.sourceEvidenceIds,
          allowed
        );
        if (sourceEvidenceIds.length === 0) return null;
        return { ...entry, sourceEvidenceIds };
      })
      .filter((entry): entry is ContactPoint => entry !== null),
    (entry) => `${entry.type}|${entry.value}`
  );
}

function scopedUrls(entries: EvidenceUrl[], allowed: Set<string>): EvidenceUrl[] {
  return dedupe(
    entries
      .map((entry) => {
        const sourceEvidenceIds = filterToAllowed(
          entry.sourceEvidenceIds,
          allowed
        );
        if (sourceEvidenceIds.length === 0) return null;
        return { ...entry, sourceEvidenceIds };
      })
      .filter((entry): entry is EvidenceUrl => entry !== null),
    (entry) => entry.value
  );
}

function scopedUncertain(
  entries: UncertainInformation[],
  allowed: Set<string>
): UncertainInformation[] {
  return dedupe(
    entries
      .map((entry) => {
        const sourceEvidenceIds = filterToAllowed(
          entry.sourceEvidenceIds,
          allowed
        );
        if (sourceEvidenceIds.length === 0) return null;
        return { ...entry, sourceEvidenceIds };
      })
      .filter((entry): entry is UncertainInformation => entry !== null),
    (entry) => `${entry.field}|${entry.reason}`
  );
}

/**
 * Builds the intelligence brief from a successful persisted correlation.
 * Pure and deterministic: it only reshapes data already present on the
 * incident, scopes every source reference to evidence that actually belongs
 * to the incident, and never synthesises content.
 */
export function buildIncidentIntelligenceBrief(
  incident: IncidentWorkspaceRecord,
  correlation: IncidentCorrelationMeta
): IncidentIntelligenceBrief {
  if (!correlation.analysis) {
    throw new PersistenceServiceError(
      "INVALID_REQUEST",
      "A successful correlation with analysis is required to build a brief."
    );
  }

  const { analysis } = correlation;
  const allowed = new Set(incident.evidence.map((item) => item.id));

  const facts = dedupe(
    analysis.facts
      .map((fact) => scopedFact(fact, allowed))
      .filter((fact): fact is IncidentIntelligenceFact => fact !== null),
    (fact) => `${fact.type}|${fact.value}|${fact.unit ?? ""}`
  );
  const financialReferences = facts.filter((fact) =>
    isFinancialFactType(fact.type)
  );
  const timeline = dedupe(
    analysis.timelineCandidates
      .map((entry) => scopedTimeline(entry, allowed))
      .filter((entry): entry is TimelineCandidate => entry !== null),
    (entry) => `${entry.event}|${entry.timestamp ?? ""}`
  );
  const identifiers = scopedIdentifiers(analysis.identifiers, allowed);
  const contactPoints = scopedContacts(analysis.contactPoints, allowed);
  const urls = scopedUrls(analysis.urls, allowed);
  const missingInformation: MissingInformation[] = dedupe(
    analysis.missingInformation,
    (entry) => `${entry.field}|${entry.reason}`
  );
  const uncertainInformation = scopedUncertain(
    analysis.uncertainInformation,
    allowed
  );

  const fromItems = uniqueIds(
    [
      ...facts.flatMap((fact) => fact.sourceEvidenceIds),
      ...timeline.flatMap((entry) => entry.sourceEvidenceIds),
      ...identifiers.flatMap((entry) => entry.sourceEvidenceIds),
      ...contactPoints.flatMap((entry) => entry.sourceEvidenceIds),
      ...urls.flatMap((entry) => entry.sourceEvidenceIds),
      ...uncertainInformation.flatMap((entry) => entry.sourceEvidenceIds),
    ]
  );
  const scopedCorrelationSources = filterToAllowed(
    correlation.sourceEvidenceIds,
    allowed
  );
  const sourceEvidenceIds =
    scopedCorrelationSources.length > 0
      ? scopedCorrelationSources
      : fromItems;

  const generatedAt =
    correlation.correlatedAt ?? correlation.startedAt ?? "";

  const incidentTypeLabel =
    INCIDENT_TYPE_LABELS[incident.type] ?? incident.type;

  const summary =
    `Incident ${incidentTypeLabel}: ${facts.length} evidence-derived ` +
    `fact${facts.length === 1 ? "" : "s"}, ` +
    `${timeline.length} timeline candidate${timeline.length === 1 ? "" : "s"} ` +
    `from ${sourceEvidenceIds.length} evidence item${sourceEvidenceIds.length === 1 ? "" : "s"}.`;

  return {
    incidentId: incident.incidentId,
    incidentType: incident.type,
    incidentTypeLabel,
    generatedAt,
    sourceCorrelationTimestamp: generatedAt,
    ...(correlation.modelId ? { modelId: correlation.modelId } : {}),
    summary,
    sourceEvidenceIds,
    facts,
    financialReferences,
    timeline,
    identifiers,
    contactPoints,
    urls,
    missingInformation,
    uncertainInformation,
  };
}

/**
 * Returns the incident intelligence for an incident. This is a read-only
 * projection of the persisted correlation: it never contacts an AI provider,
 * never invents facts, and never trusts any client-supplied content. When no
 * successful correlation exists it reports why the brief cannot be produced.
 */
export async function getIncidentIntelligence(
  incidentId: string
): Promise<IncidentIntelligence> {
  const incident = await getIncident(incidentId);
  if (!incident) {
    throw new PersistenceServiceError(
      "INCIDENT_NOT_FOUND",
      "No incident exists with this id."
    );
  }

  const correlation = incident.correlation;

  if (!correlation) {
    if (incident.evidence.length === 0) {
      return {
        status: "not_ready",
        incidentId,
        reason: "no_evidence",
        message: INTELLIGENCE_NO_EVIDENCE_MESSAGE,
      };
    }
    const anyPreserved = incident.evidence.some(
      (item) => item.storage?.status === "preserved"
    );
    if (!anyPreserved) {
      return {
        status: "not_ready",
        incidentId,
        reason: "not_preserved",
        message: INTELLIGENCE_NOT_PRESERVED_MESSAGE,
      };
    }
    const anyExtraction = incident.evidence.some(
      (item) => item.status === "processed" && item.extraction
    );
    if (!anyExtraction) {
      return {
        status: "not_ready",
        incidentId,
        reason: "extraction_unavailable",
        message: INTELLIGENCE_EXTRACTION_UNAVAILABLE_MESSAGE,
      };
    }
    return {
      status: "not_ready",
      incidentId,
      reason: "correlation_pending",
      message: INTELLIGENCE_CORRELATION_PENDING_MESSAGE,
    };
  }

  if (correlation.status === "correlated" && correlation.analysis) {
    return {
      status: "ready",
      incidentId,
      brief: buildIncidentIntelligenceBrief(incident, correlation),
    };
  }

  if (correlation.status === "correlation_failed") {
    return {
      status: "failed",
      incidentId,
      errorCode: correlation.error?.code ?? "BEDROCK_REQUEST_FAILED",
      message: INTELLIGENCE_CORRELATION_FAILED_MESSAGE,
      ...(correlation.analysis
        ? {
            previous: buildIncidentIntelligenceBrief(
              incident,
              correlation
            ),
          }
        : {}),
    };
  }

  return {
    status: "not_ready",
    incidentId,
    reason: "correlation_pending",
    message: INTELLIGENCE_CORRELATION_PENDING_MESSAGE,
  };
}