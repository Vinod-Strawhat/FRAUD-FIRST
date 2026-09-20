"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  GetIncidentPackageSuccessResponse,
  IncidentPackageResult,
  PackageError,
} from "@/types";

interface UseIncidentPackageOptions {
  incidentId: string;
  refreshKey: string;
}

export function useIncidentPackage({
  incidentId,
  refreshKey,
}: UseIncidentPackageOptions) {
  const [result, setResult] = useState<IncidentPackageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PackageError | null>(null);
  const inFlight = useRef(false);

  const fetchPackage = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/incidents/${encodeURIComponent(incidentId)}/package`,
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
        "result" in data &&
        (data as { result?: unknown }).result !== null
      ) {
        setResult(
          (data as GetIncidentPackageSuccessResponse).result
        );
        setError(null);
      } else if (
        !response.ok &&
        typeof data === "object" &&
        data !== null &&
        "error" in data
      ) {
        const err = (data as { error: Partial<PackageError> }).error;
        setResult(null);
        setError({
          code: err.code ?? "DYNAMODB_REQUEST_FAILED",
          message: err.message ?? "The package could not be generated.",
        });
      } else {
        setResult(null);
        setError({
          code: "DYNAMODB_REQUEST_FAILED",
          message: "The package service returned an unreadable response.",
        });
      }
    } catch {
      setResult(null);
      setError({
        code: "DYNAMODB_REQUEST_FAILED",
        message: "Could not reach the package service.",
      });
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [incidentId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchPackage();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchPackage, refreshKey]);

  return {
    result,
    loading,
    error,
    refresh: fetchPackage,
  };
}
