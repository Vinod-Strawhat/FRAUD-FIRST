"use client";

import { useCallback, useRef, useState } from "react";

import { evidenceService, getSessionFile } from "@/services";
import type {
  PreservationError,
  PreserveEvidenceResponse,
} from "@/types";

interface UseEvidencePreservationOptions {
  incidentId: string;
  onChanged: () => void;
}

export function useEvidencePreservation({
  incidentId,
  onChanged,
}: UseEvidencePreservationOptions) {
  const [errors, setErrors] = useState<Record<string, PreservationError>>({});
  const inFlight = useRef<Set<string>>(new Set());

  const preserveEvidence = useCallback(
    async (evidenceId: string) => {
      if (inFlight.current.has(evidenceId)) return;

      const record = evidenceService.getEvidence(evidenceId);
      if (!record) return;

      const storageStatus = record.storage?.status ?? "not_preserved";
      if (storageStatus === "preserved" || storageStatus === "preserving") {
        return;
      }

      const file = getSessionFile(evidenceId);
      if (!file) {
        setErrors((prev) => ({
          ...prev,
          [evidenceId]: {
            code: "FILE_REQUIRED",
            message:
              "File needs to be selected again before the original can be preserved.",
          },
        }));
        return;
      }

      if (!evidenceService.markPreserving(evidenceId)) return;
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
        formData.append(
          "evidence",
          JSON.stringify({
            id: record.id,
            incidentId: record.incidentId,
            filename: record.filename,
            mimeType: record.mimeType,
            size: record.size,
            category: record.category,
            capturedAt: record.capturedAt,
          })
        );
        formData.append("file", file, file.name);

        const response = await fetch("/api/evidence/upload", {
          method: "POST",
          body: formData,
        });
        const data = (await response.json()) as PreserveEvidenceResponse;

        if (data.ok) {
          evidenceService.markPreserved(evidenceId, data.storage);
        } else if (
          data.error.code === "AWS_NOT_CONFIGURED" ||
          data.error.code === "BUCKET_NOT_CONFIGURED"
        ) {
          evidenceService.markPreservationReverted(evidenceId);
          setErrors((prev) => ({ ...prev, [evidenceId]: data.error }));
        } else {
          evidenceService.markPreservationFailed(evidenceId);
          setErrors((prev) => ({ ...prev, [evidenceId]: data.error }));
        }
      } catch {
        evidenceService.markPreservationFailed(evidenceId);
        setErrors((prev) => ({
          ...prev,
          [evidenceId]: {
            code: "S3_UPLOAD_FAILED",
            message: "Could not reach the preservation service.",
          },
        }));
      } finally {
        inFlight.current.delete(evidenceId);
        onChanged();
      }
    },
    [incidentId, onChanged]
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
    preserveEvidence,
    errorFor,
    clearError,
  };
}