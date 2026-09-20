import {
  BrainCircuit,
  CheckCircle2,
  Clock3,
  CreditCard,
  Fingerprint,
  HelpCircle,
  Info,
  Link2,
  ListTree,
  Phone,
  PlusCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  ContactPoint,
  CorrelationAnalysis,
  EvidenceDerivedFact,
  EvidenceRecord,
  IdentifierReference,
  MissingInformation,
  TimelineCandidate,
  UncertainInformation,
} from "@/types";

const TRANSACTION_FACT_TYPES = new Set([
  "transaction_amount",
  "transaction_id",
  "transaction_reference",
  "transaction_date",
  "transaction_time",
  "upi_reference",
  "utr",
  "utr_number",
  "bank_name",
  "recipient_name",
  "recipient_account",
  "payment_type",
  "payment_method",
  "merchant_name",
  "note",
  "narration",
]);

function humanize(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim().split(/\s+/);
  if (words.length === 0) return "Unknown";
  const title = words.map((word) => {
    if (word.length <= 2) return word.toUpperCase();
    return word[0].toUpperCase() + word.slice(1);
  });
  return title.join(" ");
}

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function evidenceRef(
  id: string,
  evidence: EvidenceRecord[]
): string | null {
  const index = evidence.findIndex((item) => item.id === id);
  if (index < 0) return null;
  return `Evidence #${index + 1} · ${evidence[index].filename}`;
}

interface ReferenceListProps {
  ids: string[];
  evidence: EvidenceRecord[];
}

function ReferenceList({ ids, evidence }: ReferenceListProps) {
  const refs = ids
    .map((id) => evidenceRef(id, evidence))
    .filter((ref): ref is string => ref !== null);
  if (refs.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {refs.map((ref) => (
        <li
          key={ref}
          className="rounded-md border border-border/70 bg-background/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
        >
          {ref}
        </li>
      ))}
    </ul>
  );
}

function FactCard({
  fact,
  evidence,
}: {
  fact: EvidenceDerivedFact;
  evidence: EvidenceRecord[];
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-xs font-semibold uppercase tracking-wider text-foreground/80">
          {humanize(fact.type)}
        </p>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {formatConfidence(fact.confidence)} confidence
        </span>
      </div>
      <p className="mt-1 break-words text-sm font-medium text-foreground">
        {fact.value}
        {fact.unit ? (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {fact.unit}
          </span>
        ) : null}
      </p>
      {fact.sourceText ? (
        <blockquote className="mt-1.5 border-l-2 border-border/70 pl-2 text-xs italic leading-relaxed text-muted-foreground">
          “{fact.sourceText}”
        </blockquote>
      ) : null}
      <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-400/80">
        Supported by evidence
      </p>
      <ReferenceList ids={fact.sourceEvidenceIds} evidence={evidence} />
    </div>
  );
}

function TimelineCandidateCard({
  candidate,
  evidence,
}: {
  candidate: TimelineCandidate;
  evidence: EvidenceRecord[];
}) {
  const confirmed =
    candidate.label === "CONFIRMED FROM EVIDENCE" && candidate.timestamp;
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium text-foreground">
          {candidate.event}
        </p>
        <span
          className={cn(
            "shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
            confirmed
              ? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-400"
              : "border border-warning/30 bg-warning/10 text-warning"
          )}
        >
          {confirmed ? "Confirmed from evidence" : "Candidate / uncertain"}
        </span>
      </div>
      <p className="mt-1 font-mono text-xs text-muted-foreground">
        {candidate.timestamp ?? "Time unavailable from evidence"}
      </p>
      {candidate.confidence > 0 && candidate.confidence < 1 && (
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          {formatConfidence(candidate.confidence)} confidence
        </p>
      )}
      <ReferenceList ids={candidate.sourceEvidenceIds} evidence={evidence} />
    </div>
  );
}

function IdentifierCard({
  identifier,
  evidence,
}: {
  identifier: IdentifierReference;
  evidence: EvidenceRecord[];
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
        {humanize(identifier.type)}
      </p>
      <p className="mt-1 break-words font-mono text-sm text-foreground">
        {identifier.value}
      </p>
      <ReferenceList
        ids={identifier.sourceEvidenceIds}
        evidence={evidence}
      />
    </div>
  );
}

function ContactCard({
  contact,
  evidence,
}: {
  contact: ContactPoint;
  evidence: EvidenceRecord[];
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
        {humanize(contact.type)}
      </p>
      <p className="mt-1 break-words font-mono text-sm text-foreground">
        {contact.value}
      </p>
      <ReferenceList ids={contact.sourceEvidenceIds} evidence={evidence} />
    </div>
  );
}

function UrlCard({
  url,
  evidence,
}: {
  url: { value: string; sourceEvidenceIds: string[] };
  evidence: EvidenceRecord[];
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 p-3">
      <p className="break-all font-mono text-xs text-primary">{url.value}</p>
      <ReferenceList ids={url.sourceEvidenceIds} evidence={evidence} />
    </div>
  );
}

interface SectionProps {
  title: string;
  icon: typeof HelpCircle;
  count: number;
  tone?: "violet" | "neutral";
  children: React.ReactNode;
}

function Section({ title, icon: Icon, count, tone = "neutral", children }: SectionProps) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          <Icon
            className={cn("size-4", tone === "violet" && "text-violet-300")}
            aria-hidden
          />
          {title}
        </h3>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {count}
        </span>
      </div>
      {count === 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground/80">
          Nothing found in the correlated evidence.
        </p>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-2">{children}</div>
      )}
    </div>
  );
}

interface IncidentUnderstandingProps {
  evidence: EvidenceRecord[];
}

export function IncidentUnderstanding({ evidence }: IncidentUnderstandingProps) {
  const correlated = evidence.filter(
    (item) =>
      item.correlation?.status === "correlated" &&
      item.correlation.analysis !== undefined
  );

  if (correlated.length === 0) {
    return (
      <section
        aria-labelledby="incident-understanding-title"
        className="rounded-xl border border-violet-400/25 bg-card/70 p-5"
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id="incident-understanding-title"
            className="font-mono text-xs uppercase tracking-[0.2em] text-violet-300"
          >
            Incident understanding
          </h2>
          <BrainCircuit className="size-4 text-violet-300" aria-hidden />
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Correlate extracted evidence to generate traceable facts, timeline
          candidates, and missing or uncertain information. Correlation runs
          only when you explicitly trigger it.
        </p>
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground/80">
          <PlusCircle className="size-3.5 text-violet-300" aria-hidden />
          Use the Correlate evidence action on an extracted item.
        </p>
      </section>
    );
  }

  const analyses: CorrelationAnalysis[] = correlated.map(
    (item) => item.correlation?.analysis as CorrelationAnalysis
  );

  const facts = analyses.flatMap((analysis) => analysis.facts);
  const transactionFacts = facts.filter((fact) =>
    TRANSACTION_FACT_TYPES.has(fact.type)
  );
  const keyFacts = facts.filter(
    (fact) => !TRANSACTION_FACT_TYPES.has(fact.type)
  );
  const identifiers = analyses.flatMap((analysis) => analysis.identifiers);
  const contactPoints = analyses.flatMap((analysis) => analysis.contactPoints);
  const urls = analyses.flatMap((analysis) => analysis.urls);

  const timelineCandidates = analyses
    .flatMap((analysis) => analysis.timelineCandidates)
    .slice()
    .sort((a, b) => {
      if (a.timestamp && b.timestamp) return a.timestamp.localeCompare(b.timestamp);
      if (a.timestamp) return -1;
      if (b.timestamp) return 1;
      return 0;
    });

  const missingSeen = new Set<string>();
  const missingInformation: MissingInformation[] = [];
  for (const analysis of analyses) {
    for (const item of analysis.missingInformation) {
      if (missingSeen.has(item.field)) continue;
      missingSeen.add(item.field);
      missingInformation.push(item);
    }
  }

  const uncertainInformation: UncertainInformation[] = analyses.flatMap(
    (analysis) => analysis.uncertainInformation
  );

  return (
    <section
      aria-labelledby="incident-understanding-title"
      className="rounded-xl border border-violet-400/25 bg-card/70 p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="incident-understanding-title"
            className="font-mono text-xs uppercase tracking-[0.2em] text-violet-300"
          >
            AI-assisted correlation
          </h2>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Evidence-derived incident understanding · {correlated.length}{" "}
            {correlated.length === 1 ? "evidence item" : "evidence items"}{" "}
            correlated
          </p>
        </div>
        <BrainCircuit className="size-5 text-violet-300" aria-hidden />
      </div>

      <div className="mt-4 grid gap-3">
        <Section
          title="Key facts"
          icon={ListTree}
          count={keyFacts.length}
          tone="violet"
        >
          {keyFacts.map((fact) => (
            <FactCard key={fact.type + fact.value} fact={fact} evidence={evidence} />
          ))}
        </Section>

        <Section
          title="Transaction / payment details"
          icon={CreditCard}
          count={transactionFacts.length}
          tone="violet"
        >
          {transactionFacts.map((fact) => (
            <FactCard
              key={fact.type + fact.value}
              fact={fact}
              evidence={evidence}
            />
          ))}
        </Section>

        <Section
          title="Identifiers"
          icon={Fingerprint}
          count={identifiers.length}
          tone="violet"
        >
          {identifiers.map((identifier) => (
            <IdentifierCard
              key={identifier.type + identifier.value}
              identifier={identifier}
              evidence={evidence}
            />
          ))}
        </Section>

        <Section
          title="Contact points"
          icon={Phone}
          count={contactPoints.length}
        >
          {contactPoints.map((contact) => (
            <ContactCard key={contact.type + contact.value} contact={contact} evidence={evidence} />
          ))}
        </Section>

        <Section title="URLs" icon={Link2} count={urls.length}>
          {urls.map((url) => (
            <UrlCard key={url.value} url={url} evidence={evidence} />
          ))}
        </Section>

        <div className="rounded-lg border border-border/70 bg-background/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              <Clock3 className="size-4 text-violet-300" aria-hidden />
              Timeline candidates
            </h3>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {timelineCandidates.length}
            </span>
          </div>
          {timelineCandidates.length === 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground/80">
              No timeline candidates were found. Timestamps are never invented.
            </p>
          ) : (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {timelineCandidates.map((candidate, index) => (
                <TimelineCandidateCard
                  key={candidate.event + index}
                  candidate={candidate}
                  evidence={evidence}
                />
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border/70 bg-background/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              <HelpCircle className="size-4 text-warning" aria-hidden />
              Missing information
            </h3>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {missingInformation.length}
            </span>
          </div>
          {missingInformation.length === 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground/80">
              No missing fields reported in the correlated evidence.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2 md:grid-cols-2">
              {missingInformation.map((item) => (
                <li
                  key={item.field}
                  className="rounded-lg border border-border/70 bg-background/40 p-3"
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
                    {humanize(item.field)}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {item.reason}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border/70 bg-background/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              <Info className="size-4 text-warning" aria-hidden />
              Uncertain information
            </h3>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {uncertainInformation.length}
            </span>
          </div>
          {uncertainInformation.length === 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground/80">
              Nothing was flagged as uncertain in the correlated evidence.
            </p>
          ) : (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {uncertainInformation.map((item) => (
                <div
                  key={item.field + item.reason}
                  className="rounded-lg border border-border/70 bg-background/40 p-3"
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
                    {humanize(item.field)}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {item.reason}
                  </p>
                  <ReferenceList
                    ids={item.sourceEvidenceIds}
                    evidence={evidence}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-lg border border-border/70 bg-background/40 p-3 text-xs leading-relaxed text-muted-foreground">
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" aria-hidden />
        Each item above is an evidence-derived fact — it is traceable to the
        evidence that supports it. Correlation never confirms fraud, identifies
        a perpetrator, guarantees recovery, or makes evidence legally
        admissible. The preserved original remains the source of truth.
      </p>
    </section>
  );
}