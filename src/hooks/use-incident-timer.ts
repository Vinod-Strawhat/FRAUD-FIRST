"use client";

import { useEffect, useState } from "react";

export function useIncidentTimer(startedAt: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  const startedMs = startedAt ? new Date(startedAt).getTime() : null;
  const elapsedSeconds =
    startedMs && Number.isFinite(startedMs)
      ? Math.max(0, Math.floor((now - startedMs) / 1000))
      : 0;

  return { elapsedSeconds, startedMs, now };
}