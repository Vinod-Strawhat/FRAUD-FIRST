"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { responseService } from "@/services";
import type { IncidentResponseView, ResponseError } from "@/types";

const RESPONSE_POLL_INTERVAL_MS = 8000;

export function useResponsePlan(incidentId: string | undefined) {
  const [response, setResponse] = useState<IncidentResponseView | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<ResponseError | null>(null);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const inFlightRef = useRef(false);

  const reload = useCallback(async () => {
    if (!incidentId) {
      setIsReady(true);
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const result = await responseService.getResponse(incidentId);
      if (result.ok) {
        setResponse(result.response);
        setError(null);
      } else if (
        result.error.code === "RESPONSE_NOT_FOUND" ||
        result.error.code === "INCIDENT_NOT_FOUND"
      ) {
        setResponse(null);
        setError(null);
      } else {
        setError(result.error);
      }
    } finally {
      inFlightRef.current = false;
      setIsReady(true);
    }
  }, [incidentId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const responseStatus = response?.status;
  useEffect(() => {
    if (!incidentId || !responseStatus || responseStatus !== "running") return;
    const interval = window.setInterval(() => {
      void reload();
    }, RESPONSE_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [incidentId, responseStatus, reload]);

  const start = useCallback(async (): Promise<boolean> => {
    if (!incidentId) return false;
    setIsStarting(true);
    setError(null);
    const result = await responseService.startResponse(incidentId);
    setIsStarting(false);
    if (result.ok) {
      setResponse(result.response);
      return true;
    }
    setError(result.error);
    return false;
  }, [incidentId]);

  const completeAction = useCallback(
    async (actionId: string): Promise<boolean> => {
      if (!incidentId) return false;
      setBusyActionId(actionId);
      setError(null);
      const result = await responseService.completeAction(incidentId, actionId);
      setBusyActionId(null);
      if (result.ok) {
        setResponse(result.response);
        return true;
      }
      setError(result.error);
      return false;
    },
    [incidentId]
  );

  return {
    response,
    isReady,
    error,
    busyActionId,
    isStarting,
    start,
    completeAction,
    reload,
  };
}