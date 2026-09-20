"use client";

import { useCallback, useRef, useState } from "react";

import { evidenceService, getSessionFile } from "@/services";
import type {
  EvidenceExtractionResult,
  ExtractEvidenceResponse,
  ExtractionError,
} from "@/types";

interface UseEvidenceProcessingOptions {
  incidentId: string;
  onChanged: () => void;
}

export function useEvidenceProcessing({
  incidentId,
  onChanged,
}: UseEvidenceProcessingOptions) {
  const [results, setResults] = useState<
    Record<string, EvidenceExtractionResult>
  >({});
  const [errors, setErrors] = useState<Record<string, ExtractionError>>({});
  const inFlight = useRef<Set<string>>(new Set());

  const processEvidence = useCallback(
    async (evidenceId: string) => {
      if (inFlight.current.has(evidenceId)) return;

      const file = getSessionFile(evidenceId);
      if (!file) {
        setErrors((prev) => ({
          ...prev,
          [evidenceId]: {
            code: "FILE_REQUIRED",
            message: "File needs to be selected again before processing.",
          },
        }));
        return;
      }

      const record = evidenceService.getEvidence(evidenceId);
      if (!record) return;

      if (!evidenceService.markProcessing(evidenceId)) return;
      inFlight.current.add(evidenceId);
      setErrors((prev) => {
        const next = { ...prev };
        delete next[evidenceId];
        return next;
      });
      onChanged();

      try {
        const formData = new FormData();
        formData.append("incidentId", incidentId);
        formData.append("evidenceId", evidenceId);
        formData.append("file", file, file.name);

        const response = await fetch("/api/evidence/extract", {
          method: "POST",
          body: formData,
        });
        const data = (await response.json()) as ExtractEvidenceResponse;

        if (data.ok) {
          evidenceService.markProcessed(evidenceId, {
            source: data.extraction.source,
            extractedAt: data.extraction.extractedAt,
            confidence: data.extraction.confidence,
            textLength: data.extraction.text.length,
          });
          setResults((prev) => ({ ...prev, [evidenceId]: data.extraction }));
        } else if (data.error.code === "AWS_NOT_CONFIGURED") {
          evidenceService.markCaptured(evidenceId);
          setErrors((prev) => ({ ...prev, [evidenceId]: data.error }));
        } else {
          evidenceService.markFailed(evidenceId);
          setErrors((prev) => ({ ...prev, [evidenceId]: data.error }));
        }
      } catch {
        evidenceService.markFailed(evidenceId);
        setErrors((prev) => ({
          ...prev,
          [evidenceId]: {
            code: "EXTRACTION_FAILED",
            message: "Could not reach the extraction service.",
          },
        }));
      } finally {
        inFlight.current.delete(evidenceId);
        onChanged();
      }
    },
    [incidentId, onChanged]
  );

  const resultFor = useCallback(
    (evidenceId: string) => results[evidenceId],
    [results]
  );

  const errorFor = useCallback(
    (evidenceId: string) => errors[evidenceId],
    [errors]
  );

  const clearResult = useCallback((evidenceId: string) => {
    setResults((prev) => {
      const next = { ...prev };
      delete next[evidenceId];
      return next;
    });
  }, []);

  return {
    processEvidence,
    resultFor,
    errorFor,
    clearResult,
  };
}