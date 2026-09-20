"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";

import { incidentsService } from "@/services";
import type { Incident } from "@/types";

export function ActiveIncidentBar() {
  const [incident, setIncident] = useState<Incident | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIncident(incidentsService.getActiveIncident());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!incident) return null;

  return (
    <div className="relative border-b border-warning/25 bg-warning/5">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-6 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative flex size-2 shrink-0" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-warning opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-warning" />
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-warning">
            Active incident
          </span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {incident.id}
          </span>
        </div>
        <Link
          href={`/incident/${incident.id}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md text-xs font-semibold text-warning transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning"
        >
          Resume response
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  );
}