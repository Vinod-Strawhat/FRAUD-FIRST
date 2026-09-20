"use client";

import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Loader2,
  RefreshCcw,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useIncidentCorrelation } from "@/hooks/use-incident-correlation";
import type {
  EvidenceRecord,
  IncidentCorrelationMeta,
} from "@/types";

interface IncidentCorrelationProps {
  incidentId: string;
  evidence: EvidenceRecord[];
  getText: (evidenceId: string) => string | undefined;
  onChanged: () => void;
}

function NotReadyList({ meta }: { meta: IncidentCorrelationMeta }) {
  if (meta.notReadyEvidence.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        No evidence is ready to correlate yet. Process evidence to extract text
        first.
      </p>
    );
  }
  return (
    <ul className="mt-3 space-y-2">
      {meta.notReadyEvidence.map((entry) => (
        <li
          key={entry.evidenceId}
          className="rounded-lg border border-warning/25 bg-warning/5 p-3 text-xs"
        >
          <p className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-warning">
              {entry.filename ?? entry.evidenceId}
            </span>
            <span className="font-mono uppercase tracking-wider text-warning/70">
              {entry.state.replace(/_/g, " ")}
            </span>
          </p>
          <p className="mt-1 leading-relaxed text-foreground/80">
            {entry.reason}
          </p>
        </li>
      ))}
    </ul>
  );
}

function FactList({ meta }: { meta: IncidentCorrelationMeta }) {
  const analysis = meta.analysis;
  if (!analysis) return null;
  if (analysis.facts.length === 0 && analysis.timelineCandidates.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        The correlation completed but found no traceable facts or timeline
        candidates in the supplied text.
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-4">
      {analysis.facts.length > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Evidence-derived facts
          </p>
          <ul className="mt-2 space-y-2">
            {analysis.facts.map((fact, index) => (
              <li
                key={`${fact.type}-${index}`}
                className="rounded-lg border border-border/70 bg-background/40 p-3 text-xs"
              >
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono uppercase tracking-wider text-primary">
                    {fact.type.replace(/_/g, " ")}
                  </span>
                  {fact.unit && (
                    <span className="font-mono text-foreground/60">{fact.unit}</span>
                  )}
                  <span className="font-mono text-foreground/60">
                    {Math.round(fact.confidence * 100)}%
                  </span>
                </p>
                <p className="mt-1 break-words text-sm font-medium text-foreground">
                  {fact.value}
                </p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  From {fact.sourceEvidenceIds.join(", ") || "evidence"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.timelineCandidates.length > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Timeline candidates
          </p>
          <ul className="mt-2 space-y-2">
            {analysis.timelineCandidates.map((candidate, index) => (
              <li
                key={`${candidate.event}-${index}`}
                className="rounded-lg border border-border/70 bg-background/40 p-3 text-xs"
              >
                <p className="flex items-center gap-2">
                  <span className="font-medium">
                    {candidate.timestamp ?? "No timestamp in evidence"}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-[10px] uppercase tracking-wider",
                      candidate.label === "CONFIRMED FROM EVIDENCE"
                        ? "text-emerald-400"
                        : "text-warning"
                    )}
                  >
                    {candidate.label.replace(/_/g, " ")}
                  </span>
                </p>
                <p className="mt-1 break-words text-foreground">{candidate.event}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  From {candidate.sourceEvidenceIds.join(", ") || "evidence"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.identifiers.length > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Identifiers
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {analysis.identifiers.map((identifier, index) => (
              <li
                key={`${identifier.type}-${index}`}
                className="rounded-lg border border-border/70 bg-background/40 px-3 py-1.5 text-xs"
              >
                <span className="font-mono uppercase tracking-wider text-muted-foreground">
                  {identifier.type.replace(/_/g, " ")}
                </span>{" "}
                <span className="break-all font-mono text-foreground">
                  {identifier.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.contactPoints.length > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Contact points
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {analysis.contactPoints.map((contact, index) => (
              <li
                key={`${contact.type}-${index}`}
                className="rounded-lg border border-border/70 bg-background/40 px-3 py-1.5 text-xs"
              >
                <span className="font-mono uppercase tracking-wider text-muted-foreground">
                  {contact.type.replace(/_/g, " ")}
                </span>{" "}
                <span className="break-all font-mono text-foreground">
                  {contact.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.urls.length > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Referenced URLs
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {analysis.urls.map((url, index) => (
              <li
                key={`${url.value}-${index}`}
                className="max-w-full break-all rounded-lg border border-border/70 bg-background/40 px-3 py-1.5 font-mono text-xs text-foreground/90"
              >
                {url.value}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Links are shown as plain text only, never opened.
          </p>
        </div>
      )}

      {analysis.missingInformation.length > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Missing information
          </p>
          <ul className="mt-2 space-y-1.5">
            {analysis.missingInformation.map((item, index) => (
              <li key={`${item.field}-${index}`} className="text-xs text-foreground/70">
                <span className="font-medium text-foreground/85">{item.field}</span>{" "}
                — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.uncertainInformation.length > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Uncertain information
          </p>
          <ul className="mt-2 space-y-1.5">
            {analysis.uncertainInformation.map((item, index) => (
              <li
                key={`${item.field}-${index}`}
                className="rounded-lg border border-warning/25 bg-warning/5 px-3 py-1.5 text-xs"
              >
                {item.field} — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function IncidentCorrelation({
  incidentId,
  evidence,
  getText,
  onChanged,
}: IncidentCorrelationProps) {
  const { correlation, loading, correlating, error, readyWithText, correlateIncident } =
    useIncidentCorrelation({ incidentId, evidence, getText, onChanged });

  const correlationError = error ?? correlation?.error ?? null;
  const providerUnavailable =
    correlationError !== null &&
    (correlationError.code === "BEDROCK_NOT_CONFIGURED" ||
      correlationError.code === "BEDROCK_REQUEST_FAILED" ||
      correlationError.code === "OPENROUTER_NOT_CONFIGURED" ||
      correlationError.code === "OPENROUTER_REQUEST_FAILED");

  return (
    <div aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-violet-300">
          <BrainCircuit className="size-4" aria-hidden />
          Incident correlation
        </p>
        {correlation?.correlatedAt && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {formatDateTime(correlation.correlatedAt)}
          </span>
        )}
      </div>

      {loading ? (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Loading correlation status…
        </p>
      ) : correlation === null ? (
        <div className="mt-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Correlate all processed evidence into a single, traceable incident
            summary: facts, timeline candidates, and missing or uncertain
            information.
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            onClick={() => void correlateIncident()}
            disabled={correlating || !readyWithText}
          >
            {correlating ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-3.5" aria-hidden />
            )}
            {correlating ? "Correlating…" : "Correlate evidence"}
          </Button>
          {!readyWithText && (
            <p className="mt-2 text-xs leading-relaxed text-warning">
              Process evidence first so its text can be included in the correlation.
            </p>
          )}
        </div>
      ) : correlation.status === "correlating" ? (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 text-xs text-violet-300"
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Correlating this incident&apos;s extracted text…
        </p>
      ) : correlation.status === "not_ready" ? (
        <div role="alert" className="mt-3">
          <p className="flex items-center gap-2 text-xs font-medium text-warning">
            <AlertTriangle className="size-3.5" aria-hidden />
            Correlation isn’t ready yet
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {correlation.evidenceCount} evidence item(s) reviewed,{" "}
            {correlation.readyCount} ready. Nothing was sent to the model.
          </p>
          <NotReadyList meta={correlation} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => void correlateIncident()}
            disabled={!readyWithText}
          >
            <RefreshCcw className="size-3.5" aria-hidden />
            Re-check
          </Button>
        </div>
      ) : correlation.status === "correlation_failed" ? (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3"
        >
          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-destructive">
            <AlertTriangle className="size-4" aria-hidden />
            {providerUnavailable ? "Correlation unavailable" : "Correlation failed"}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground/85">
            {providerUnavailable
              ? "AI correlation is currently unavailable. Preserved evidence and extracted text remain available."
              : (correlationError?.message ??
                "AI correlation failed. Preserved evidence and extracted text remain available.")}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-foreground/70">
            {correlation.evidenceCount} evidence item(s) reviewed,{" "}
            {correlation.readyCount} ready.
          </p>
          {correlation.analysis && (
            <div className="mt-3 rounded-lg border border-border/70 bg-background/40 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Last successful correlation
                {correlation.correlatedAt
                  ? ` — ${formatDateTime(correlation.correlatedAt)}`
                  : ""}
              </p>
              <FactList meta={correlation} />
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void correlateIncident()}
            disabled={correlating}
          >
            <RefreshCcw className="size-3.5" aria-hidden />
            Try again
          </Button>
        </div>
      ) : correlation.status === "correlated" ? (
        <div className="mt-3">
          <p className="flex items-center gap-2 text-xs font-medium text-emerald-400">
            <CheckCircle2 className="size-3.5" aria-hidden />
            Correlated {correlation.readyCount} of {correlation.evidenceCount}{" "}
            evidence item(s)
          </p>
          {correlation.modelId && (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {correlation.provider === "openrouter"
                ? "OpenRouter fallback"
                : "Bedrock"}{" "}
              · Model {correlation.modelId} ·{" "}
              {typeof correlation.durationMs === "number"
                ? `${(correlation.durationMs / 1000).toFixed(1)}s`
                : "duration not recorded"}
            </p>
          )}
          <FactList meta={correlation} />
          {correlation.notReadyEvidence.length > 0 && (
            <div className="mt-3 rounded-lg border border-warning/25 bg-warning/5 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-warning">
                Not included
              </p>
              <NotReadyList meta={correlation} />
            </div>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => void correlateIncident()}
            disabled={correlating}
          >
            <RefreshCcw className="size-3.5" aria-hidden />
            Re-correlate
          </Button>
        </div>
      ) : null}
    </div>
  );
}