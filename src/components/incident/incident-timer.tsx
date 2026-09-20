"use client";

import { Clock } from "lucide-react";

import { useIncidentTimer } from "@/hooks/use-incident-timer";
import { formatClock, formatElapsed, formatStartedAgo } from "@/lib/format";

interface IncidentTimerProps {
  startedAt: string;
}

export function IncidentTimer({ startedAt }: IncidentTimerProps) {
  const { elapsedSeconds, now } = useIncidentTimer(startedAt);
  const minutes = Math.max(0, Math.floor(elapsedSeconds / 60));
  const announced = `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;

  return (
    <section
      aria-labelledby="response-time-title"
      className="rounded-xl border border-primary/25 bg-card/70 p-5"
    >
      <div className="flex items-center justify-between">
        <h2
          id="response-time-title"
          className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground"
        >
          Response time
        </h2>
        <Clock className="size-4 text-primary" aria-hidden />
      </div>

      <p className="mt-3 font-mono text-5xl font-semibold tracking-tight text-foreground tabular-nums sm:text-6xl">
        {formatElapsed(elapsedSeconds)}
      </p>

      <span className="sr-only" aria-live="polite">
        Incident active for {announced}.
      </span>

      <dl className="mt-4 space-y-1 border-t border-border/70 pt-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">Incident started</dt>
          <dd className="font-mono text-foreground tabular-nums">
            {formatClock(startedAt)}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        {formatStartedAgo(startedAt, now)}
      </p>
    </section>
  );
}