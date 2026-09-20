"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";

import { startNewIncident } from "@/services";

export function useStartIncident() {
  const router = useRouter();
  const pending = useRef(false);

  return useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    const incident = startNewIncident();
    router.push(`/incident/${incident.id}`);
  }, [router]);
}