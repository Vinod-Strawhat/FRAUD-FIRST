"use client";

import { CheckCircle2, Clock, Loader2, Play, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useIncidentTimer } from "@/hooks/use-incident-timer";
import { useResponsePlan } from "@/hooks/use-response-plan";
import { formatClock, formatElapsed } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  IncidentResponseView,
  ResponseError,
  ResponseErrorCode,
} from "@/types";

interface ResponsePlanProps {
  incidentId: string;
  startedAt: string;
  onChanged?: () => void;
}

const ERROR_HINTS: Partial<Record<ResponseErrorCode, string>> = {
  STEP_FUNCTIONS_NOT_CONFIGURED:
    "Response orchestration requires Step Functions to be configured for this environment.",
  STEP_FUNCTIONS_REQUEST_FAILED:
    "The response workflow service could not be reached. Try again in a moment.",
  RESPONSE_ALREADY_STARTED:
    "A response plan is already running for this incident.",
};

function formatError(error: ResponseError): string {
  return (
    ERROR_HINTS[error.code] ??
    error.message ??
    "The response plan is unavailable right now."
  );
}

function ResponseStatusPill({ response }: { response: IncidentResponseView | null }) {
  const running = response?.status === "running";
  const completed = response?.status === "completed";
  const failed = response?.status === "failed";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]",
        completed
          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-400"
          : failed
            ? "border-red-400/40 bg-red-400/10 text-red-400"
            : running
              ? "border-warning/30 bg-warning/10 text-warning"
              : "border-border/70 bg-background/60 text-muted-foreground"
      )}
    >
      {completed ? (
        <CheckCircle2 className="size-3" aria-hidden />
      ) : failed ? (
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-red-400"
        />
      ) : running ? (
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-warning" />
      ) : null}
      {completed
        ? "Complete"
        : failed
          ? "Response failed"
          : running
            ? "Response running"
            : "Not started"}
    </span>
  );
}

function WorkflowStatusLine({ response }: { response: IncidentResponseView }) {
  const executionStatus = response.executionStatus;
  if (!executionStatus) return null;
  const tone =
    executionStatus === "COMPLETED"
      ? "text-emerald-400"
      : executionStatus === "FAILED" || executionStatus === "STOPPED"
        ? "text-red-400"
        : executionStatus === "RUNNING" || executionStatus === "STARTING"
          ? "text-warning"
          : "text-muted-foreground";
  const label =
    executionStatus === "COMPLETED"
      ? "Workflow complete"
      : executionStatus === "FAILED"
        ? "Workflow failed"
        : executionStatus === "STOPPED"
          ? "Workflow stopped"
          : executionStatus === "STARTING"
            ? "Workflow starting"
            : "Workflow running";
  return (
    <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
      Step Functions ·{" "}
      <span className={cn("font-semibold", tone)}>{label}</span>
      {response.executionArn ? " · reconciled with live execution status" : " · unreconciled"}
    </p>
  );
}

function ActionRow({
  action,
  isCurrent,
  index,
  busyActionId,
  onComplete,
}: {
  action: IncidentResponseView["actions"][number];
  isCurrent: boolean;
  index: number;
  busyActionId: string | null;
  onComplete: (actionId: string) => void;
}) {
  const completed = action.status === "completed" || action.status === "skipped";
  const busy = busyActionId === action.id;

  if (completed) {
    return (
      <li
        className="rounded-lg border border-border/70 bg-background/40 p-3"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0">
            <CheckCircle2 className="size-4 text-emerald-400" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-foreground/70 line-through decoration-foreground/30">
                {action.title}
              </p>
              {action.completedAt ? (
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  done {formatClock(action.completedAt)}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-400/70">
              Completed · Marked by you
            </p>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li
      className={cn(
        "rounded-lg border p-4",
        isCurrent
          ? "border-primary/40 bg-primary/10 shadow-[0_0_0_1px_rgba(34,211,238,0.15),0_12px_40px_-16px_rgba(34,211,238,0.35)]"
          : "border-border/70 bg-background/40"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md font-mono text-sm font-bold",
            isCurrent
              ? "bg-primary text-primary-foreground"
              : "border border-border bg-background text-muted-foreground"
          )}
          aria-hidden
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p
              className={cn(
                "text-sm font-semibold leading-snug",
                isCurrent ? "text-foreground" : "text-foreground/85"
              )}
            >
              {action.title}
            </p>
            {isCurrent ? (
              <span className="shrink-0 rounded-md border border-primary/40 bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                Recommended next step
              </span>
            ) : (
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                {action.guidance ?? "Next"}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {action.description}
          </p>
          {isCurrent ? (
            <div className="mt-3">
              <Button
                className="w-full sm:w-auto"
                size="sm"
                onClick={() => onComplete(action.id)}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-4" aria-hidden />
                )}
                {busy ? "Updating…" : "Mark complete"}
              </Button>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                Only after YOU have done this — FraudFirst never performs it for you.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

interface GroupedActions {
  completed: IncidentResponseView["actions"];
  current: IncidentResponseView["actions"];
  upcoming: IncidentResponseView["actions"];
}

function groupActions(response: IncidentResponseView): GroupedActions {
  const currentType = response.currentActionType;
  const completed = response.actions.filter(
    (action) => action.status === "completed" || action.status === "skipped"
  );
  const pending = response.actions.filter(
    (action) => action.status === "pending" || action.status === "in_progress"
  );
  const current = pending.filter((action) => action.type === currentType);
  const upcoming = pending.filter((action) => action.type !== currentType);
  return { completed, current, upcoming };
}

function ActionSequence({
  response,
  busyActionId,
  onComplete,
  onRestart,
}: {
  response: IncidentResponseView;
  busyActionId: string | null;
  onComplete: (actionId: string) => void;
  onRestart: () => void;
}) {
  const { completed, current, upcoming } = groupActions(response);
  const total = response.actions.length;
  const done = completed.length;

  const renderGroup = (
    label: string,
    actions: IncidentResponseView["actions"],
    isCurrent: boolean
  ) => {
    if (actions.length === 0) return null;
    const baseIndex = response.actions.findIndex(
      (entry) => entry.id === actions[0].id
    );
    return (
      <>
        <p className="mt-4 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        <ol className="mt-2 space-y-2">
          {actions.map((action, offset) => (
            <ActionRow
              key={action.id}
              action={action}
              index={baseIndex + offset}
              isCurrent={isCurrent}
              busyActionId={busyActionId}
              onComplete={onComplete}
            />
          ))}
        </ol>
      </>
    );
  };

  return (
    <div>
      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Response progress
          </span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {done} of {total} complete
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-label="Response plan progress"
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-border/60"
        >
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%` }}
          />
        </div>
      </div>

      {renderGroup("What happened", completed, true)}
      {renderGroup("What to do now", current, true)}
      {renderGroup("What comes next", upcoming, false)}

      {response.status === "failed" ? (
        <div className="mt-4 rounded-lg border border-red-400/40 bg-red-400/10 p-4">
          <p className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-red-400">
            <ShieldCheck className="size-4" aria-hidden />
            {response.executionStatus === "STOPPED"
              ? "Response workflow stopped"
              : "Response workflow failed"}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-foreground/85">
            The live response workflow could not be completed before every step
            was finished. You can restart the plan to resume guidance, or keep
            working through the remaining steps on your own.
          </p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            onClick={onRestart}
          >
            <Play className="size-4" aria-hidden />
            Restart response plan
          </Button>
        </div>
      ) : null}

      {response.status === "completed" ? (
        <div className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-4">
          <p className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
            <ShieldCheck className="size-4" aria-hidden />
            Response plan complete
          </p>
          <p className="mt-2 text-sm leading-relaxed text-foreground/85">
            All steps were marked complete by you. Continue following up on the
            case until it closes. FraudFirst did not place these calls, freeze
            accounts, or recover money.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function ResponsePlan({
  incidentId,
  startedAt,
  onChanged,
}: ResponsePlanProps) {
  const {
    response,
    isReady,
    error,
    busyActionId,
    isStarting,
    start,
    completeAction,
  } = useResponsePlan(incidentId);
  const { elapsedSeconds } = useIncidentTimer(startedAt);

  const handleComplete = async (actionId: string) => {
    const ok = await completeAction(actionId);
    if (ok) onChanged?.();
  };

  const handleStart = async () => {
    const ok = await start();
    if (ok) onChanged?.();
  };

  return (
    <section
      aria-labelledby="response-plan-title"
      className="rounded-xl border border-primary/25 bg-card/70 p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2
            id="response-plan-title"
            className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-primary"
          >
            Response plan
          </h2>
          <ResponseStatusPill response={response} />
        </div>
        <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground tabular-nums">
          <Clock className="size-3.5 text-primary" aria-hidden />
          {formatElapsed(elapsedSeconds)} since incident started
        </span>
      </div>

      {response ? <WorkflowStatusLine response={response} /> : null}

      {!isReady ? (
        <div className="mt-5 space-y-3" role="status" aria-label="Loading response plan">
          <div className="h-20 animate-pulse rounded-lg bg-border/40" />
          <div className="h-12 animate-pulse rounded-lg bg-border/40" />
          <div className="h-12 animate-pulse rounded-lg bg-border/40" />
        </div>
      ) : response ? (
        <ActionSequence
          response={response}
          busyActionId={busyActionId}
          onComplete={handleComplete}
          onRestart={handleStart}
        />
      ) : (
        <div className="mt-5">
          {error ? (
            <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm leading-relaxed text-warning">
              {formatError(error)}
            </p>
          ) : null}
          <div className="rounded-lg border border-border/70 bg-background/40 p-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Start the time-aware response plan to lock in the recommended
              sequence: preserve evidence, contact your bank, contact 1930,
              report cybercrime, and follow up.
            </p>
            <Button
              className="mt-4 w-full sm:w-auto"
              onClick={handleStart}
              disabled={isStarting}
            >
              {isStarting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Play className="size-4" aria-hidden />
              )}
              {isStarting ? "Starting…" : "Start response plan"}
            </Button>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
              Starting requires the Step Functions workflow. FraudFirst does not
              contact banks, 1930, or portals for you.
            </p>
          </div>
        </div>
      )}

      <p className="mt-4 border-t border-border/70 pt-3 text-xs leading-relaxed text-muted-foreground">
        FraudFirst is an orchestration and guidance layer. Each step stays
        pending until you explicitly mark it complete. Nothing reports a step
        that was not actually performed by you.
      </p>
    </section>
  );
}