"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  GetIncidentIntelligenceSuccessResponse,
  IncidentIntelligence,
  PersistenceError,
} from "@/types";

interface UseIncidentIntelligenceOptions {
  incidentId: string;
  refreshKey: string;
}

export function useIncidentIntelligence({
  incidentId,
  refreshKey,
}: UseIncidentIntelligenceOptions) {
  const [intelligence, setIntelligence] = useState<IncidentIntelligence | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PersistenceError | null>(null);
  const inFlight = useRef(false);

  const fetchIntelligence = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/incidents/${encodeURIComponent(incidentId)}/intelligence`,
        { method: "GET", headers: { Accept: "application/json" } }
      );

      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (
        response.ok &&
        typeof data === "object" &&
        data !== null &&
        "intelligence" in data &&
        (data as { intelligence?: unknown }).intelligence !== null
      ) {
        setIntelligence(
          (data as GetIncidentIntelligenceSuccessResponse).intelligence
        );
        setError(null);
      } else if (
        !response.ok &&
        typeof data === "object" &&
        data !== null &&
        "error" in data
      ) {
        const err = (data as { error: Partial<PersistenceError> }).error;
        setIntelligence(null);
        setError({
          code: err.code ?? "DYNAMODB_REQUEST_FAILED",
          message:
            err.message ?? "Incident intelligence is currently unavailable.",
        });
      } else {
        setIntelligence(null);
        setError({
          code: "DYNAMODB_REQUEST_FAILED",
          message: "Incident intelligence is currently unavailable.",
        });
      }
    } catch {
      setIntelligence(null);
      setError({
        code: "DYNAMODB_REQUEST_FAILED",
        message: "Could not reach the intelligence service.",
      });
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [incidentId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchIntelligence();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchIntelligence, refreshKey]);

  return {
    intelligence,
    loading,
    error,
    refresh: fetchIntelligence,
  };
}
