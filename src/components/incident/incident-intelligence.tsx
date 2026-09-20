"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileQuestion,
  FileWarning,
  Hourglass,
  Loader2,
  ScanSearch,
  ShieldOff,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateTime, formatBytes } from "@/lib/format";
import { EVIDENCE_CATEGORY_LABELS } from "@/types/evidence";
import { useIncidentIntelligence } from "@/hooks/use-incident-intelligence";
import type {
  EvidenceRecord,
  IncidentIntelligence,
  IncidentIntelligenceBrief,
  IncidentIntelligenceFact,
  IntelligenceNotReadyReason,
  TimelineCandidate,
} from "@/types";

interface IncidentIntelligenceProps {
  incidentId: string;
  evidence: EvidenceRecord[];
  refreshKey: string;
}

const NOT_READY_HINTS: Record<IntelligenceNotReadyReason, string> = {
  no_evidence: "Add evidence to this incident to begin building a brief.",
  not_preserved:
    "Preserve captured evidence to lock a secure copy, then process it.",
  extraction_unavailable:
    "Process preserved evidence to extract text for correlation.",
  correlation_pending:
    "Correlation has not completed yet. The brief will appear here as soon as a correlation succeeds.",
};

const NOT_READY_ICONS: Record<IntelligenceNotReadyReason, typeof FileQuestion> = {
  no_evidence: FileQuestion,
  not_preserved: ShieldOff,
  extraction_unavailable: FileWarning,
  correlation_pending: Hourglass,
};

function StatusBadge({ intelligence }: { intelligence: IncidentIntelligence }) {
  const ready = intelligence.status === "ready";
  const failed = intelligence.status === "failed";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        ready
          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-400"
          : failed
            ? "border-destructive/40 bg-destructive/10 text-destructive"
            : "border-warning/30 bg-warning/10 text-warning"
      )}
    >
      {ready ? (
        <CheckCircle2 className="size-3" aria-hidden />
      ) : failed ? (
        <AlertTriangle className="size-3" aria-hidden />
      ) : (
        <Hourglass className="size-3" aria-hidden />
      )}
      {ready ? "Correlated" : failed ? "Failed" : "Not ready"}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

function SourceEvidenceCard({
  evidenceId,
  evidence,
}: {
  evidenceId: string;
  evidence: EvidenceRecord[];
}) {
  const item = evidence.find((entry) => entry.id === evidenceId);
  if (!item) {
    return (
      <div className="rounded-md border border-border/60 bg-background/60 p-3 text-xs text-muted-foreground">
        Source evidence <span className="font-mono">{evidenceId}</span> is not
        present in this incident’s current evidence list.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border/60 bg-background/60 p-3 text-xs">
      <p className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="break-all font-medium text-foreground">
          {item.filename}
        </span>
        <span className="font-mono uppercase tracking-wider text-muted-foreground">
          {item.status.replace(/_/g, " ")}
        </span>
      </p>
      <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
        <li>
          {item.category in EVIDENCE_CATEGORY_LABELS
            ? EVIDENCE_CATEGORY_LABELS[item.category]
            : item.category}
          {" · "}
          {formatBytes(item.size)}
        </li>
        <li>
          {item.storage?.status === "preserved" ? "Preserved" : "Not preserved"}
          {" · "}
          Captured {formatDateTime(item.capturedAt)}
        </li>
        {item.storage?.preservedAt ? (
          <li>Secure copy {formatDateTime(item.storage.preservedAt)}</li>
        ) : null}
      </ul>
      <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
        Metadata only — raw extracted text is never shown.
      </p>
    </div>
  );
}

function SourceChips({
  evidenceIds,
  evidence,
}: {
  evidenceIds: string[];
  evidence: EvidenceRecord[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {evidenceIds.map((id) => {
        const isOpen = open === id;
        return (
          <span key={id} className="inline-flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : id)}
              aria-expanded={isOpen}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                isOpen
                  ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"
                  : "border-border/70 bg-background/40 text-muted-foreground hover:text-foreground"
              )}
            >
              {isOpen ? (
                <ChevronDown className="size-3" aria-hidden />
              ) : (
                <ChevronRight className="size-3" aria-hidden />
              )}
              {id}
            </button>
            {isOpen && <SourceEvidenceCard evidenceId={id} evidence={evidence} />}
          </span>
        );
      })}
    </div>
  );
}

function FactRows({
  facts,
  evidence,
}: {
  facts: IncidentIntelligenceFact[];
  evidence: EvidenceRecord[];
}) {
  return (
    <ul className="mt-2 space-y-2">
      {facts.map((fact, index) => (
        <li
          key={`${fact.type}-${fact.value}-${index}`}
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
          <SourceChips evidenceIds={fact.sourceEvidenceIds} evidence={evidence} />
        </li>
      ))}
    </ul>
  );
}

function TimelineList({
  timeline,
  evidence,
}: {
  timeline: TimelineCandidate[];
  evidence: EvidenceRecord[];
}) {
  return (
    <ul className="mt-2 space-y-2">
      {timeline.map((entry, index) => (
        <li
          key={`${entry.event}-${entry.timestamp ?? ""}-${index}`}
          className="rounded-lg border border-border/70 bg-background/40 p-3 text-xs"
        >
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">
              {entry.timestamp ?? "No timestamp in evidence"}
            </span>
            <span
              className={cn(
                "font-mono text-[10px] uppercase tracking-wider",
                entry.label === "CONFIRMED FROM EVIDENCE"
                  ? "text-emerald-400"
                  : "text-warning"
              )}
            >
              {entry.label.replace(/_/g, " ")}
            </span>
            <span className="font-mono text-foreground/60">
              {Math.round(entry.confidence * 100)}%
            </span>
          </p>
          <p className="mt-1 break-words text-foreground">{entry.event}</p>
          <SourceChips evidenceIds={entry.sourceEvidenceIds} evidence={evidence} />
        </li>
      ))}
    </ul>
  );
}

function ChipList({
  items,
  evidence,
}: {
  items: { type: string; value: string; sourceEvidenceIds: string[] }[];
  evidence: EvidenceRecord[];
}) {
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {items.map((item, index) => (
        <li
          key={`${item.type}-${item.value}-${index}`}
          className="rounded-lg border border-border/70 bg-background/40 px-3 py-1.5 text-xs"
        >
          <span className="font-mono uppercase tracking-wider text-muted-foreground">
            {item.type.replace(/_/g, " ")}
          </span>{" "}
          <span className="break-all font-mono text-foreground">
            {item.value}
          </span>
          <SourceChips evidenceIds={item.sourceEvidenceIds} evidence={evidence} />
        </li>
      ))}
    </ul>
  );
}

function BriefView({
  brief,
  evidence,
}: {
  brief: IncidentIntelligenceBrief;
  evidence: EvidenceRecord[];
}) {
  const hasFacts = brief.facts.length > 0;
  const hasTimeline = brief.timeline.length > 0;
  if (!hasFacts && !hasTimeline) {
    return (
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        The correlation completed but found no traceable facts or timeline
        candidates in the supplied evidence.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-4">
      {brief.financialReferences.length > 0 && (
        <div>
          <SectionLabel>Financial and transaction references</SectionLabel>
          <FactRows facts={brief.financialReferences} evidence={evidence} />
        </div>
      )}

      {brief.timeline.length > 0 && (
        <div>
          <SectionLabel>Timeline</SectionLabel>
          <TimelineList timeline={brief.timeline} evidence={evidence} />
        </div>
      )}

      {brief.identifiers.length > 0 && (
        <div>
          <SectionLabel>Identifiers</SectionLabel>
          <ChipList items={brief.identifiers} evidence={evidence} />
        </div>
      )}

      {brief.contactPoints.length > 0 && (
        <div>
          <SectionLabel>Contact points</SectionLabel>
          <ChipList items={brief.contactPoints} evidence={evidence} />
        </div>
      )}

      {brief.urls.length > 0 && (
        <div>
          <SectionLabel>Referenced URLs</SectionLabel>
          <ul className="mt-2 flex flex-wrap gap-2">
            {brief.urls.map((url, index) => (
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

      {brief.facts.length > 0 && (
        <div>
          <SectionLabel>Evidence</SectionLabel>
          <FactRows facts={brief.facts} evidence={evidence} />
        </div>
      )}

      {brief.missingInformation.length > 0 && (
        <div>
          <SectionLabel>Missing information</SectionLabel>
          <ul className="mt-2 space-y-1.5">
            {brief.missingInformation.map((item, index) => (
              <li
                key={`${item.field}-${index}`}
                className="text-xs text-foreground/70"
              >
                <span className="font-medium text-foreground/85">
                  {item.field}
                </span>{" "}
                — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.uncertainInformation.length > 0 && (
        <div>
          <SectionLabel>Uncertain information</SectionLabel>
          <ul className="mt-2 space-y-1.5">
            {brief.uncertainInformation.map((item, index) => (
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

      <div>
        <SectionLabel>Source evidence</SectionLabel>
        <SourceChips evidenceIds={brief.sourceEvidenceIds} evidence={evidence} />
      </div>
    </div>
  );
}

export function IncidentIntelligence({
  incidentId,
  evidence,
  refreshKey,
}: IncidentIntelligenceProps) {
  const { intelligence, loading, error } = useIncidentIntelligence({
    incidentId,
    refreshKey,
  });

  return (
    <div aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-cyan-300">
          <ScanSearch className="size-4" aria-hidden />
          Incident intelligence
        </p>
        {intelligence ? (
          <div className="flex items-center gap-2">
            {intelligence.status === "ready" && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {formatDateTime(intelligence.brief.generatedAt)}
              </span>
            )}
            <StatusBadge intelligence={intelligence} />
          </div>
        ) : null}
      </div>

      {loading ? (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Building intelligence brief…
        </p>
      ) : error && !intelligence ? (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs"
        >
          <p className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="size-3.5" aria-hidden />
            Intelligence unavailable
          </p>
          <p className="mt-1 leading-relaxed text-foreground/85">
            {error.message || "Incident intelligence is currently unavailable. Evidence and incident metadata remain available."}
          </p>
        </div>
      ) : intelligence?.status === "not_ready" ? (
        <div role="status" className="mt-3">
          <p className="flex items-center gap-2 text-xs font-medium text-warning">
            {(() => {
              const Icon = NOT_READY_ICONS[intelligence.reason];
              return <Icon className="size-3.5" aria-hidden />;
            })()}
            {intelligence.message}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {NOT_READY_HINTS[intelligence.reason]}
          </p>
        </div>
      ) : intelligence?.status === "failed" ? (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3"
        >
          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-destructive">
            <AlertTriangle className="size-4" aria-hidden />
            {intelligence.message}
          </p>
          {intelligence.previous && (
            <div className="mt-3 rounded-lg border border-border/70 bg-background/40 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Last successful correlation
                {intelligence.previous.generatedAt
                  ? ` — ${formatDateTime(intelligence.previous.generatedAt)}`
                  : ""}
              </p>
              <BriefView brief={intelligence.previous} evidence={evidence} />
            </div>
          )}
        </div>
      ) : intelligence?.status === "ready" ? (
        <div className="mt-3">
          <div className="rounded-lg border border-border/70 bg-background/40 p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              What happened
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground">
              {intelligence.brief.summary}
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Incident type · {intelligence.brief.incidentTypeLabel}
            </p>
          </div>
          <BriefView brief={intelligence.brief} evidence={evidence} />
        </div>
      ) : null}
    </div>
  );
}