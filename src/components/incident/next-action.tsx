import {
  ArrowRight,
  CheckCircle2,
  Clock,
  PhoneCall,
  Play,
  type LucideIcon,
} from "lucide-react";

import type { IncidentResponseView } from "@/types";

interface NextActionProps {
  response: IncidentResponseView | null;
}

const ACTION_ICONS: Record<string, LucideIcon> = {
  preserve_evidence: CheckCircle2,
  contact_bank: PhoneCall,
  contact_1930: PhoneCall,
  report_cybercrime: ArrowRight,
  follow_up: Clock,
};

export function NextAction({ response }: NextActionProps) {
  if (!response) {
    return (
      <section
        aria-labelledby="next-action-title"
        className="rounded-xl border border-border bg-card/70 p-5"
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id="next-action-title"
            className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground"
          >
            Next action
          </h2>
          <Play className="size-4 text-muted-foreground" aria-hidden />
        </div>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Start the response plan to get step-by-step guidance for what to do
          next.
        </p>
      </section>
    );
  }

  const completed = response.actions.filter(
    (a) => a.status === "completed" || a.status === "skipped"
  );
  const pending = response.actions.filter(
    (a) => a.status === "pending" || a.status === "in_progress"
  );
  const currentAction = pending.find(
    (a) => a.type === response.currentActionType
  );

  if (response.status === "completed") {
    return (
      <section
        aria-labelledby="next-action-title"
        className="rounded-xl border border-emerald-400/30 bg-card/70 p-5"
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id="next-action-title"
            className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-400"
          >
            All steps complete
          </h2>
          <CheckCircle2 className="size-4 text-emerald-400" aria-hidden />
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          All response steps have been marked complete. Continue following up on
          the case.
        </p>
      </section>
    );
  }

  if (response.status === "failed") {
    return (
      <section
        aria-labelledby="next-action-title"
        className="rounded-xl border border-destructive/30 bg-card/70 p-5"
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id="next-action-title"
            className="font-mono text-xs uppercase tracking-[0.2em] text-destructive"
          >
            Response paused
          </h2>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The response workflow was interrupted. You can restart it from the
          response plan section.
        </p>
      </section>
    );
  }

  if (!currentAction) {
    return null;
  }

  const Icon = ACTION_ICONS[currentAction.type] ?? ArrowRight;

  return (
    <section
      aria-labelledby="next-action-title"
      className="rounded-xl border border-primary/25 bg-card/70 p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="next-action-title"
          className="font-mono text-xs uppercase tracking-[0.2em] text-primary"
        >
          Next action
        </h2>
        <Icon className="size-4 text-primary" aria-hidden />
      </div>

      <div className="mt-4 rounded-lg border border-primary/30 bg-primary/10 p-4">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
          Step {response.actions.indexOf(currentAction) + 1} of{" "}
          {response.actions.length}
        </p>
        <p className="mt-1 text-lg font-semibold leading-snug text-foreground">
          {currentAction.title}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {currentAction.description}
        </p>
      </div>

      <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="size-3 text-emerald-400" aria-hidden />
          {completed.length} done
        </span>
        <span aria-hidden className="h-3 w-px bg-border" />
        <span>{pending.length} remaining</span>
      </div>

      <p className="mt-3 border-t border-border/70 pt-3 text-xs leading-relaxed text-muted-foreground">
        FraudFirst does not recover money or freeze transactions. Each step stays
        pending until you mark it complete.
      </p>
    </section>
  );
}
