"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { ConsolePanel } from "@/components/incident/console-panel";
import { EvidenceIntake } from "@/components/incident/evidence-intake";
import { EvidenceList } from "@/components/incident/evidence-list";
import { IncidentCorrelation } from "@/components/incident/incident-correlation";
import { IncidentHeader } from "@/components/incident/incident-header";
import { IncidentIntelligence } from "@/components/incident/incident-intelligence";
import { IncidentPackage } from "@/components/incident/incident-package";
import { IncidentTimeline } from "@/components/incident/incident-timeline";
import { IncidentTimer } from "@/components/incident/incident-timer";
import { IncidentTopBar } from "@/components/incident/incident-top-bar";
import { IncidentUnderstanding } from "@/components/incident/incident-understanding";
import { NextAction } from "@/components/incident/next-action";
import { ResponsePlan } from "@/components/incident/response-plan";
import { WhatToDoNow } from "@/components/incident/what-to-do-now";
import { useEvidenceCorrelation } from "@/hooks/use-evidence-correlation";
import { useEvidencePreservation } from "@/hooks/use-evidence-preservation";
import { useEvidenceProcessing } from "@/hooks/use-evidence-processing";
import { useIncident } from "@/hooks/use-incident";
import { useResponsePlan } from "@/hooks/use-response-plan";
import { Button } from "@/components/ui/button";

interface IncidentWorkspaceProps {
  incidentId: string;
}

export function IncidentWorkspace({ incidentId }: IncidentWorkspaceProps) {
  const {
    incident,
    evidence,
    timeline,
    isReady,
    restoreDone,
    persistence,
    addFiles,
    removeEvidence,
    hasFile,
    reload,
  } = useIncident(incidentId);
  const { processEvidence, resultFor, errorFor } = useEvidenceProcessing({
    incidentId,
    onChanged: reload,
  });
  const { preserveEvidence, errorFor: storageErrorFor } =
    useEvidencePreservation({
      incidentId,
      onChanged: reload,
    });
  const { correlateEvidence, errorFor: correlationErrorFor } =
    useEvidenceCorrelation({
      incidentId,
      getText: (evidenceId) => resultFor(evidenceId)?.text ?? null,
      onChanged: reload,
    });
  const { response } = useResponsePlan(
    isReady && incident ? incidentId : undefined
  );

  if (!isReady || (!incident && !restoreDone)) {
    return (
      <div
        role="status"
        aria-label="Loading incident"
        className="incident-console flex min-h-dvh items-center justify-center bg-background text-foreground"
      >
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Loading incident…
        </span>
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="incident-console min-h-dvh bg-background text-foreground">
        <div className="mx-auto w-full max-w-md px-6 py-24 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-xl border border-warning/30 bg-warning/10">
            <ShieldAlert className="size-6 text-warning" aria-hidden />
          </span>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">
            Incident not found
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            No incident with ID{" "}
            <span className="font-mono text-foreground">{incidentId}</span>{" "}
            could be restored from this browser or the incident store.
          </p>
          <Link href="/" className="mt-8 inline-block">
            <Button size="lg">Return to FraudFirst</Button>
          </Link>
        </div>
      </div>
    );
  }

  const hasResponsePlan = response !== null;

  return (
    <div className="incident-console relative min-h-dvh bg-background text-foreground">
      <IncidentTopBar
        incidentId={incident.id}
        startedAt={incident.startedAt}
        persistence={persistence}
      />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(ellipse_60%_60%_at_50%_-25%,rgba(34,211,238,0.08),transparent)]"
      />

      <main className="relative mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <ConsolePanel>
          <IncidentHeader incident={incident} />
        </ConsolePanel>

        <div className="mt-4 flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
          <div className="order-last space-y-4 lg:col-start-1 lg:row-start-1">
            <ConsolePanel delay={0.02}>
              <ResponsePlan
                incidentId={incident.id}
                startedAt={incident.startedAt}
                onChanged={reload}
              />
            </ConsolePanel>
            {!hasResponsePlan && (
              <ConsolePanel delay={0.05}>
                <WhatToDoNow />
              </ConsolePanel>
            )}
            <ConsolePanel delay={0.1}>
              <EvidenceIntake onFiles={addFiles} />
            </ConsolePanel>
            <ConsolePanel delay={0.15}>
              <EvidenceList
                evidence={evidence}
                hasFile={(id) => hasFile(id) !== null}
                onRemove={removeEvidence}
                onProcess={processEvidence}
                onPreserve={preserveEvidence}
                resultFor={resultFor}
                errorFor={errorFor}
                storageErrorFor={storageErrorFor}
                onCorrelate={correlateEvidence}
                correlationErrorFor={correlationErrorFor}
              />
            </ConsolePanel>
            <ConsolePanel delay={0.18}>
              <IncidentUnderstanding evidence={evidence} />
            </ConsolePanel>
            <ConsolePanel delay={0.19}>
              <IncidentCorrelation
                incidentId={incident.id}
                evidence={evidence}
                getText={(evidenceId) => resultFor(evidenceId)?.text}
                onChanged={reload}
              />
            </ConsolePanel>
            <ConsolePanel delay={0.2}>
              <IncidentIntelligence
                incidentId={incident.id}
                evidence={evidence}
                refreshKey={incident.updatedAt}
              />
            </ConsolePanel>
            <ConsolePanel delay={0.21}>
              <IncidentPackage
                incidentId={incident.id}
                refreshKey={incident.updatedAt}
              />
            </ConsolePanel>
            <ConsolePanel delay={0.22}>
              <IncidentTimeline timeline={timeline} />
            </ConsolePanel>
          </div>

          <aside className="order-first space-y-4 lg:col-start-2 lg:row-start-1 lg:self-start lg:sticky lg:top-20">
            <ConsolePanel delay={0.05}>
              <IncidentTimer startedAt={incident.startedAt} />
            </ConsolePanel>
            <ConsolePanel delay={0.1}>
              <NextAction response={response} />
            </ConsolePanel>
          </aside>
        </div>
      </main>
    </div>
  );
}
