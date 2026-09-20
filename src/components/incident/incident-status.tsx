import { INCIDENT_STATUS_LABELS } from "@/types";
import type { IncidentStatus as IncidentStatusValue } from "@/types";

interface IncidentStatusProps {
  status: IncidentStatusValue;
}

export function IncidentStatus({ status }: IncidentStatusProps) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-300">
      <span className="relative flex size-1.5" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-70" />
        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
      </span>
      {INCIDENT_STATUS_LABELS[status]}
    </span>
  );
}