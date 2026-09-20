import { CalendarClock, Banknote, Tag } from "lucide-react";

import { IncidentStatus } from "@/components/incident/incident-status";
import { formatDateTime } from "@/lib/format";
import { INCIDENT_TYPE_LABELS } from "@/types";
import type { Incident } from "@/types";

interface IncidentHeaderProps {
  incident: Incident;
}

export function IncidentHeader({ incident }: IncidentHeaderProps) {
  return (
    <section aria-labelledby="incident-header-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1
            id="incident-header-title"
            className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-foreground"
          >
            Scam incident
          </h1>
          <IncidentStatus status={incident.status} />
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {incident.id}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card/60 px-4 py-3">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5 text-primary" aria-hidden />
            Started
          </dt>
          <dd className="mt-1 text-sm font-medium text-foreground">
            {formatDateTime(incident.startedAt)}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-card/60 px-4 py-3">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Tag className="size-3.5 text-primary" aria-hidden />
            Incident type
          </dt>
          <dd className="mt-1 text-sm font-medium text-foreground">
            {INCIDENT_TYPE_LABELS[incident.type]}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-card/60 px-4 py-3">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Banknote className="size-3.5 text-primary" aria-hidden />
            Amount
          </dt>
          <dd className="mt-1 text-sm font-medium text-foreground">
            {incident.amount ?? "Not provided"}
          </dd>
        </div>
      </dl>
    </section>
  );
}