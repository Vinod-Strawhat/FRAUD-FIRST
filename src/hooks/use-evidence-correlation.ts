"use client";

import { useCallback, useRef, useState } from "react";

import { evidenceService } from "@/services";
import type {
  CorrelationError,
  CorrelateEvidenceResponse,
} from "@/types";

interface UseEvidenceCorrelationOptions {
  incidentId: string;
  getText: (evidenceId: string) => string | null;
  onChanged: () => void;
}

export function useEvidenceCorrelation({
  incidentId,
  getText,
  onChanged,
}: UseEvidenceCorrelationOptions) {
  const [errors, setErrors] = useState<Record<string, CorrelationError>>({});
  const inFlight = useRef<Set<string>>(new Set());

  const correlateEvidence = useCallback(
    async (evidenceId: string) => {
      if (inFlight.current.has(evidenceId)) return;

      const record = evidenceService.getEvidence(evidenceId);
      if (!record) return;

      const correlationStatus = record.correlation?.status ?? "not_correlated";
      if (correlationStatus === "correlating") return;

      const text = getText(evidenceId);
      if (!text) {
        setErrors((prev) => ({
          ...prev,
          [evidenceId]: {
            code: "EXTRACTION_NOT_AVAILABLE",
            message:
              "Extracted text is not available. Extract the text again before correlating.",
          },
        }));
        return;
      }

      if (!evidenceService.markCorrelating(evidenceId)) return;
      inFlight.current.add(evidenceId);
      setErrors((prev) => {
        const next = { ...prev };
        delete next[evidenceId];
        return next;
      });
      onChanged();

      try {
        const response = await fetch("/api/evidence/correlate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            incidentId,
            evidenceId,
            evidence: {
              id: record.id,
              incidentId: record.incidentId,
              filename: record.filename,
              mimeType: record.mimeType,
              size: record.size,
              category: record.category,
              capturedAt: record.capturedAt,
              extraction: {
                source: record.extraction?.source,
                extractedAt: record.extraction?.extractedAt,
                confidence: record.extraction?.confidence,
                textLength: record.extraction?.textLength,
                text,
              },
            },
          }),
        });
        const data = (await response.json()) as CorrelateEvidenceResponse;

        if (data.ok) {
          evidenceService.markCorrelated(evidenceId, data.correlation);
        } else if (data.error.code === "BEDROCK_NOT_CONFIGURED") {
          evidenceService.markCorrelationReverted(evidenceId);
          setErrors((prev) => ({ ...prev, [evidenceId]: data.error }));
        } else {
          evidenceService.markCorrelationFailed(evidenceId, data.error);
          setErrors((prev) => ({ ...prev, [evidenceId]: data.error }));
        }
      } catch {
        evidenceService.markCorrelationFailed(evidenceId, {
          code: "BEDROCK_REQUEST_FAILED",
          message: "Could not reach the correlation service.",
        });
        setErrors((prev) => ({
          ...prev,
          [evidenceId]: {
            code: "BEDROCK_REQUEST_FAILED",
            message: "Could not reach the correlation service.",
          },
        }));
      } finally {
        inFlight.current.delete(evidenceId);
        onChanged();
      }
    },
    [incidentId, getText, onChanged]
  );

  const errorFor = useCallback(
    (evidenceId: string) => errors[evidenceId],
    [errors]
  );

  const clearError = useCallback((evidenceId: string) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[evidenceId];
      return next;
    });
  }, []);

  return {
    correlateEvidence,
    errorFor,
    clearError,
  };
}