"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchRemoteIncident } from "@/services/incident-sync";
import type {
  CorrelationError,
  CorrelationTextClaim,
  CorrelateIncidentResponse,
  EvidenceRecord,
  IncidentCorrelationMeta,
} from "@/types";

interface UseIncidentCorrelationOptions {
  incidentId: string;
  evidence: EvidenceRecord[];
  getText: (evidenceId: string) => string | undefined;
  onChanged: () => void;
}

export function useIncidentCorrelation({
  incidentId,
  evidence,
  getText,
  onChanged,
}: UseIncidentCorrelationOptions) {
  const [correlation, setCorrelation] = useState<IncidentCorrelationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [correlating, setCorrelating] = useState(false);
  const [error, setError] = useState<CorrelationError | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    const result = await fetchRemoteIncident(incidentId);
    if (result.ok) {
      setCorrelation(result.incident.correlation ?? null);
    } else if (result.error.code === "INCIDENT_NOT_FOUND") {
      setCorrelation(null);
    }
    setLoading(false);
  }, [incidentId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fetchRemoteIncident(incidentId);
      if (cancelled) return;
      if (result.ok) {
        setCorrelation(result.incident.correlation ?? null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [incidentId]);

  const correlateIncident = useCallback(async () => {
    if (inFlight.current) return;
    const claims: CorrelationTextClaim[] = [];
    for (const item of evidence) {
      const text = getText(item.id);
      if (item.status === "processed" && typeof text === "string" && text.length > 0) {
        claims.push({
          evidenceId: item.id,
          text,
          source: item.extraction?.source,
          confidence: item.extraction?.confidence,
          extractedAt: item.extraction?.extractedAt,
        });
      }
    }

    inFlight.current = true;
    setCorrelating(true);
    setError(null);

    try {
      const response = await fetch("/api/evidence/correlate-incident", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId, claims }),
      });
      const data = (await response.json()) as CorrelateIncidentResponse;
      if (data.ok) {
        setCorrelation(data.correlation);
        onChanged();
      } else {
        setError(data.error);
      }
    } catch {
      setError({
        code: "BEDROCK_REQUEST_FAILED",
        message: "Could not reach the correlation service.",
      });
    } finally {
      inFlight.current = false;
      setCorrelating(false);
    }
  }, [evidence, getText, incidentId, onChanged]);

  const readyWithText = evidence.some(
    (item) => item.status === "processed" && typeof getText(item.id) === "string"
  );

  return {
    correlation,
    loading,
    correlating,
    error,
    readyWithText,
    correlateIncident,
    refresh,
  };
}