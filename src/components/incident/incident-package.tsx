"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileDown,
  Loader2,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { useIncidentPackage } from "@/hooks/use-incident-package";
import { Button } from "@/components/ui/button";
import type { IncidentPackageReady, IncidentPackageResult } from "@/types";

interface IncidentPackageProps {
  incidentId: string;
  refreshKey: string;
}

type DownloadStage = "idle" | "generating" | "downloaded" | "error";

const NOT_READY_HINTS: Record<
  Extract<IncidentPackageResult, { status: "not_ready" }>["reason"],
  string
> = {
  no_evidence: "Add evidence to this incident before generating a package.",
  not_preserved:
    "Preserve at least one piece of evidence to lock a secure copy, then generate the package.",
};

function ReadyBadge({ ready }: { ready: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        ready
          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-400"
          : "border-warning/30 bg-warning/10 text-warning"
      )}
    >
      {ready ? (
        <ShieldCheck className="size-3" aria-hidden />
      ) : (
        <AlertTriangle className="size-3" aria-hidden />
      )}
      {ready ? "Package ready" : "Not ready"}
    </span>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "muted";
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-xs font-medium",
          tone === "good"
            ? "text-emerald-400"
            : tone === "warn"
              ? "text-warning"
              : "text-foreground"
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function IncidentPackage({
  incidentId,
  refreshKey,
}: IncidentPackageProps) {
  const { result, loading, error } = useIncidentPackage({
    incidentId,
    refreshKey,
  });
  const [stage, setStage] = useState<DownloadStage>("idle");
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const triggerDownload = useCallback(async () => {
    if (inFlight.current || result?.status !== "ready") return;
    inFlight.current = true;
    setDownloadError(null);
    setStage("generating");

    let response: Response;
    try {
      response = await fetch(
        `/api/incidents/${encodeURIComponent(incidentId)}/package/download`,
        { method: "GET" }
      );
    } catch {
      setDownloadError("The package could not be downloaded. Please try again.");
      setStage("error");
      window.setTimeout(() => {
        inFlight.current = false;
        setStage("idle");
      }, 3000);
      return;
    }

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const message =
        typeof body === "object" &&
        body !== null &&
        "message" in body &&
        typeof (body as { message?: unknown }).message === "string"
          ? (body as { message: string }).message
          : "The package could not be generated.";
      setDownloadError(message);
      setStage("error");
      window.setTimeout(() => {
        inFlight.current = false;
        setStage("idle");
      }, 3000);
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `FraudFirst-${incidentId}-Incident-Package.pdf`;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStage("downloaded");
    window.setTimeout(() => {
      inFlight.current = false;
      setStage("idle");
    }, 3000);
  }, [incidentId, result]);

  const ready = result?.status === "ready";
  const pkg = ready ? (result as IncidentPackageReady).package : null;

  const completedActions =
    pkg?.response.started
      ? pkg.response.actions.filter(
          (action) => action.status === "completed" || action.status === "skipped"
        ).length
      : 0;

  return (
    <div aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-cyan-300">
          <FileDown className="size-4" aria-hidden />
          Incident package
        </p>
        {result && <ReadyBadge ready={result.status === "ready"} />}
      </div>

      {loading ? (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Checking package readiness…
        </p>
      ) : error && !result ? (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs"
        >
          <p className="flex items-center gap-2 font-medium text-destructive">
            <AlertCircle className="size-3.5" aria-hidden />
            Package unavailable
          </p>
          <p className="mt-1 leading-relaxed text-foreground/85">{error.message}</p>
        </div>
      ) : result?.status === "not_ready" ? (
        <div role="status" className="mt-3">
          <p className="flex items-center gap-2 text-xs font-medium text-warning">
            <AlertTriangle className="size-3.5" aria-hidden />
            {result.message}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {NOT_READY_HINTS[result.reason]}
          </p>
        </div>
      ) : pkg ? (
        <div className="mt-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Stat label="Incident" value={pkg.incident.incidentId} />
            <Stat label="Generated" value={formatDateTime(pkg.generatedAt)} />
            <Stat
              label="Evidence"
              value={`${pkg.evidenceIndex.length} items · ${pkg.integrity.preservedCount} preserved · ${pkg.integrity.unpreservedCount} unpreserved`}
            />
            <Stat
              label="Intelligence"
              value={
                pkg.intelligence.available ? "Available" : "Unavailable"
              }
              tone={pkg.intelligence.available ? "good" : "warn"}
            />
            <Stat
              label="Response"
              value={
                pkg.response.started
                  ? `${completedActions} of ${pkg.response.actions.length} actions completed`
                  : "Not started"
              }
            />
            <Stat
              label="Integrity"
              value={
                pkg.integrity.hashesIncluded
                  ? "SHA-256 fingerprints included"
                  : "No preserved originals recorded"
              }
              tone={pkg.integrity.hashesIncluded ? "good" : "muted"}
            />
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            The package is a read-only snapshot of this incident at generation
            time. It includes the evidence index, preservation and integrity
            details, the intelligence brief (when available) and the response
            status. It is not a police report or a recovery guarantee.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              onClick={triggerDownload}
              disabled={stage === "generating"}
            >
              {stage === "generating" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <FileDown className="size-4" aria-hidden />
              )}
              {stage === "generating"
                ? "Generating package…"
                : "Download incident package"}
            </Button>

            {stage === "downloaded" ? (
              <span
                role="status"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400"
              >
                <CheckCircle2 className="size-3.5" aria-hidden />
                Package generated. Check your downloads.
              </span>
            ) : null}

            {downloadError ? (
              <span
                role="alert"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive"
              >
                <AlertCircle className="size-3.5" aria-hidden />
                {downloadError}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}