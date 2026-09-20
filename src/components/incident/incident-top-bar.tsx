"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { FraudFirstLogo } from "@/components/brand/fraud-first-logo";
import { PersistenceStatus } from "@/components/incident/persistence-status";
import { useIncidentTimer } from "@/hooks/use-incident-timer";
import { formatElapsed } from "@/lib/format";
import type { PersistenceStatus as PersistenceStatusType } from "@/types";

interface IncidentTopBarProps {
  incidentId: string;
  startedAt: string;
  persistence?: PersistenceStatusType;
}

export function IncidentTopBar({
  incidentId,
  startedAt,
  persistence = "local",
}: IncidentTopBarProps) {
  const { elapsedSeconds } = useIncidentTimer(startedAt);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            href="/"
            aria-label="Return to FraudFirst home"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
          <span className="hidden sm:block">
            <FraudFirstLogo />
          </span>
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:hidden">
            FraudFirst
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <span className="hidden md:inline-flex">
            <PersistenceStatus status={persistence} />
          </span>
          <span className="relative flex size-2 shrink-0" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
          </span>
          <span className="hidden font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400 md:inline">
            Incident active
          </span>
          <span className="truncate font-mono text-xs font-semibold text-foreground">
            {incidentId}
          </span>
          <span aria-hidden className="h-4 w-px shrink-0 bg-border/80" />
          <span className="shrink-0 font-mono text-xs text-foreground tabular-nums">
            <span className="text-muted-foreground">Elapsed: </span>
            {formatElapsed(elapsedSeconds)}
          </span>
        </div>
      </div>
    </header>
  );
}