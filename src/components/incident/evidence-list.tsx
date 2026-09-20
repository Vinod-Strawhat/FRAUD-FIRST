"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BrainCircuit,
  Check,
  CheckCircle2,
  ClipboardCopy,
  CloudOff,
  CloudUpload,
  File,
  FileImage,
  FileText,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatBytes, formatClock, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  CorrelationError,
  EvidenceExtractionResult,
  EvidenceRecord,
  ExtractionError,
  PreservationError,
} from "@/types";

function fileIconFor(mimeType: string): LucideIcon {
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType === "application/pdf") return FileText;
  return File;
}

function isImageEligible(mimeType: string): boolean {
  return mimeType === "image/png" || mimeType === "image/jpeg";
}

function isWebp(mimeType: string): boolean {
  return mimeType === "image/webp";
}

function isPdf(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

interface EvidenceListProps {
  evidence: EvidenceRecord[];
  hasFile: (evidenceId: string) => boolean;
  onRemove: (evidenceId: string) => void;
  onProcess: (evidenceId: string) => void;
  onPreserve: (evidenceId: string) => void;
  resultFor: (evidenceId: string) => EvidenceExtractionResult | undefined;
  errorFor: (evidenceId: string) => ExtractionError | undefined;
  storageErrorFor: (evidenceId: string) => PreservationError | undefined;
  onCorrelate: (evidenceId: string) => void;
  correlationErrorFor: (evidenceId: string) => CorrelationError | undefined;
}

export function EvidenceList({
  evidence,
  hasFile,
  onRemove,
  onProcess,
  onPreserve,
  resultFor,
  errorFor,
  storageErrorFor,
  onCorrelate,
  correlationErrorFor,
}: EvidenceListProps) {
  const count = evidence.length;
  const [copied, setCopied] = useState<Record<string, boolean>>({});

  const copySha256 = async (evidenceId: string, sha256: string) => {
    try {
      await navigator.clipboard.writeText(sha256);
      setCopied((prev) => ({ ...prev, [evidenceId]: true }));
      window.setTimeout(() => {
        setCopied((prev) => ({ ...prev, [evidenceId]: false }));
      }, 1800);
    } catch {
      setCopied((prev) => ({ ...prev, [evidenceId]: false }));
    }
  };

  return (
    <section
      aria-labelledby="evidence-list-title"
      className="rounded-xl border border-border bg-card/70 p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="evidence-list-title"
          className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground"
        >
          Evidence
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          {count} {count === 1 ? "item" : "items"}
        </span>
      </div>

      <div className="sr-only" aria-live="polite">
        {count} evidence {count === 1 ? "item" : "items"} in this incident.
      </div>

      {count === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No evidence captured yet. Add files to preserve what you have.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          <AnimatePresence initial={false}>
            {evidence.map((item, index) => {
              const Icon = fileIconFor(item.mimeType);
              const fileAvailable = hasFile(item.id);
              const eligible = isImageEligible(item.mimeType);
              const result = resultFor(item.id);
              const error = errorFor(item.id);
              const isProcessing = item.status === "processing";
              const isProcessed = item.status === "processed";
              const isFailed = item.status === "failed";
              const storageStatus = item.storage?.status ?? "not_preserved";
              const isPreservingStorage = storageStatus === "preserving";
              const isPreservedStorage = storageStatus === "preserved";
              const isPreservationFailed =
                storageStatus === "preservation_failed";
              const storageError = storageErrorFor(item.id);
              const storageSha256 =
                item.storage?.status === "preserved"
                  ? (item.storage.sha256 ?? null)
                  : null;
              const storagePreservedAt = item.storage?.preservedAt ?? null;
              const storageBucket = item.storage?.bucket ?? null;
              const correlationStatus =
                item.correlation?.status ?? "not_correlated";
              const isCorrelating = correlationStatus === "correlating";
              const isCorrelated = correlationStatus === "correlated";
              const isCorrelationFailed =
                correlationStatus === "correlation_failed";
              const correlationError = correlationErrorFor(item.id);
              const correlationAnalysis = isCorrelated
                ? item.correlation?.analysis
                : undefined;

              return (
                <motion.li
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  aria-busy={isProcessing || isPreservingStorage}
                  className="rounded-lg border border-border/70 bg-background/40 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                        <Icon className="size-4 text-primary" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          Evidence #{index + 1}
                        </p>
                        <p className="mt-0.5 break-all text-sm font-medium text-foreground">
                          {item.filename}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemove(item.id)}
                      disabled={isProcessing || isPreservingStorage}
                      aria-label={`Remove evidence ${item.filename}`}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>

                  <div aria-live="polite">
                    <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
                      <div>
                        <dt className="font-normal text-muted-foreground">
                          Status
                        </dt>
                        <dd className="mt-0.5 flex items-center gap-1.5 font-medium text-emerald-400">
                          {isProcessing && (
                            <Loader2
                              className="size-3 animate-spin text-warning"
                              aria-hidden
                            />
                          )}
                          {isProcessed && (
                            <CheckCircle2
                              className="size-3 text-primary"
                              aria-hidden
                            />
                          )}
                          {isFailed && (
                            <AlertTriangle
                              className="size-3 text-destructive"
                              aria-hidden
                            />
                          )}
                          {isProcessing
                            ? "Processing"
                            : isProcessed
                              ? "Processed"
                              : isFailed
                                ? "Failed"
                                : "Captured"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-normal text-muted-foreground">
                          Text extraction
                        </dt>
                        <dd
                          className={cn(
                            "mt-0.5",
                            isProcessing
                              ? "text-warning"
                              : isFailed
                                ? "text-destructive"
                                : isProcessed
                                  ? "text-primary"
                                  : "text-foreground/80"
                          )}
                        >
                          {isProcessing
                            ? "Extracting text…"
                            : isProcessed
                              ? isPdf(item.mimeType)
                                ? "Not processed"
                                : "Text extracted"
                              : isFailed
                                ? "Extraction failed"
                                : isPdf(item.mimeType)
                                  ? "Not processed"
                                  : "Not processed yet"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-normal text-muted-foreground">
                          Category
                        </dt>
                        <dd className="mt-0.5 text-foreground/80">
                          Unclassified
                        </dd>
                      </div>
                      <div>
                        <dt className="font-normal text-muted-foreground">
                          Correlation
                        </dt>
                        <dd
                          className={cn(
                            "mt-0.5",
                            isCorrelating
                              ? "text-violet-300"
                              : isCorrelationFailed
                                ? "text-warning"
                                : isCorrelated
                                  ? "text-primary"
                                  : "text-foreground/80"
                          )}
                        >
                          {isCorrelating
                            ? "Correlating…"
                            : isCorrelationFailed
                              ? "Failed"
                              : isCorrelated
                                ? "Correlated"
                                : "Ready"}
                        </dd>
                      </div>
                    </dl>

                    {isPreservedStorage && storageSha256 && (
                      <div className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/5 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-emerald-400">
                            <ShieldCheck className="size-4" aria-hidden />
                            Original preserved
                          </p>
                          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-400/80">
                            <CloudUpload className="size-3.5" aria-hidden />
                            S3-backed storage
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400/60">
                          Tamper-evident original
                        </p>
                        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                          <div className="sm:col-span-2">
                            <dt className="font-normal text-muted-foreground">
                              SHA-256 fingerprint
                            </dt>
                            <dd className="mt-0.5 flex items-center gap-2">
                              <code className="min-w-0 flex-1 truncate rounded-md border border-border/70 bg-background/60 px-2 py-1 font-mono text-[11px] text-foreground/90">
                                {storageSha256}
                              </code>
                              <button
                                type="button"
                                onClick={() => copySha256(item.id, storageSha256)}
                                aria-label="Copy SHA-256 fingerprint"
                                className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {copied[item.id] ? (
                                  <Check className="size-3" aria-hidden />
                                ) : (
                                  <ClipboardCopy className="size-3" aria-hidden />
                                )}
                                {copied[item.id] ? "Copied" : "Copy"}
                              </button>
                            </dd>
                          </div>
                          <div>
                            <dt className="font-normal text-muted-foreground">
                              Preserved
                            </dt>
                            <dd className="mt-0.5 text-foreground/90">
                              {storagePreservedAt
                                ? formatDateTime(storagePreservedAt)
                                : "\u2014"}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-normal text-muted-foreground">
                              Storage
                            </dt>
                            <dd className="mt-0.5 font-mono text-foreground/90">
                              {storageBucket ?? "Amazon S3"}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    )}

                    {isPreservingStorage && (
                      <p
                        role="status"
                        className="mt-3 flex items-center gap-2 text-xs text-warning"
                      >
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        Preserving… uploading the original to S3
                      </p>
                    )}

                    {(isPreservationFailed || storageError) && (
                      <div
                        role="alert"
                        className={cn(
                          "mt-3 rounded-lg border p-3",
                          storageError?.code === "AWS_NOT_CONFIGURED" ||
                            storageError?.code === "BUCKET_NOT_CONFIGURED"
                            ? "border-warning/40 bg-warning/10"
                            : "border-destructive/40 bg-destructive/10"
                        )}
                      >
                        <p
                          className={cn(
                            "flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.15em]",
                            storageError?.code === "AWS_NOT_CONFIGURED" ||
                              storageError?.code === "BUCKET_NOT_CONFIGURED"
                              ? "text-warning"
                              : "text-destructive"
                          )}
                        >
                          <CloudOff className="size-4" aria-hidden />
                          {storageError?.code === "AWS_NOT_CONFIGURED"
                            ? "AWS storage unavailable"
                            : storageError?.code === "BUCKET_NOT_CONFIGURED"
                              ? "Evidence bucket unavailable"
                              : "Preservation failed"}
                        </p>
                        <p className="mt-1.5 text-sm leading-relaxed text-foreground/85">
                          {storageError?.code === "AWS_NOT_CONFIGURED"
                            ? "Cloud storage is currently unavailable. Evidence is stored locally on this device."
                            : storageError?.code === "BUCKET_NOT_CONFIGURED"
                              ? "Evidence bucket is not configured. Evidence is stored locally on this device."
                              : storageError?.message ??
                                "The original file could not be preserved. Select it again and retry."}
                        </p>
                        {fileAvailable && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={() => onPreserve(item.id)}
                          >
                            <RotateCcw className="size-3.5" aria-hidden />
                            Try again
                          </Button>
                        )}
                      </div>
                    )}

                    {(storageStatus === "not_preserved" ||
                      isPreservationFailed) && (
                      <div className="mt-3">
                        {!fileAvailable && (
                          <p className="mb-2 text-xs leading-relaxed text-warning">
                            File from an earlier session — select it again before
                            the original can be preserved.
                          </p>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onPreserve(item.id)}
                          disabled={!fileAvailable || isPreservingStorage}
                        >
                          <CloudUpload className="size-3.5" aria-hidden />
                          Preserve Original
                        </Button>
                      </div>
                    )}

                    {(isFailed || error) && (
                      <div
                        role="alert"
                        className={cn(
                          "mt-3 rounded-lg border p-3",
                          error?.code === "AWS_NOT_CONFIGURED"
                            ? "border-warning/40 bg-warning/10"
                            : "border-destructive/40 bg-destructive/10"
                        )}
                      >
                        <p
                          className={cn(
                            "flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.15em]",
                            error?.code === "AWS_NOT_CONFIGURED"
                              ? "text-warning"
                              : "text-destructive"
                          )}
                        >
                          {error?.code === "AWS_NOT_CONFIGURED" && (
                            <CloudOff className="size-4" aria-hidden />
                          )}
                          {error?.code === "AWS_NOT_CONFIGURED"
                            ? "AWS processing unavailable"
                            : "Extraction failed"}
                        </p>
                        <p className="mt-1.5 text-sm leading-relaxed text-foreground/85">
                          {error?.code === "AWS_NOT_CONFIGURED"
                            ? "Text extraction is currently unavailable. The original evidence is preserved."
                            : error?.message ??
                              "The text could not be extracted from this file."}
                        </p>
                        {eligible && (
                          <Button
                            type="button"
                            variant={
                              error?.code === "AWS_NOT_CONFIGURED"
                                ? "outline"
                                : "outline"
                            }
                            size="sm"
                            className="mt-3"
                            onClick={() => onProcess(item.id)}
                          >
                            <RotateCcw className="size-3.5" aria-hidden />
                            Try again
                          </Button>
                        )}
                      </div>
                    )}

                    {isProcessed && result && (
                      <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                        <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-primary">
                          <CheckCircle2 className="size-4" aria-hidden />
                          Text extracted
                        </p>
                        <div className="mt-2">
                          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            Extracted text
                          </p>
                          <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-background/60 p-3 text-xs leading-relaxed text-foreground">
                            {result.text || "(no text found in image)"}
                          </pre>
                        </div>
                        <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                          <div>
                            <dt className="font-normal text-muted-foreground">
                              Source
                            </dt>
                            <dd className="mt-0.5 font-mono text-foreground/90">
                              {result.source === "tesseract"
                                ? "Tesseract OCR (fallback)"
                                : "AWS Textract"}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-normal text-muted-foreground">
                              Confidence
                            </dt>
                            <dd className="mt-0.5 font-mono text-foreground/90">
                              {typeof result.confidence === "number"
                                ? `${result.confidence}%`
                                : "\u2014"}
                            </dd>
                          </div>
                        </dl>
                        {eligible && (
                          <button
                            type="button"
                            onClick={() => onProcess(item.id)}
                            className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
                          >
                            <RotateCcw className="size-3" aria-hidden />
                            Extract again
                          </button>
                        )}
                      </div>
                    )}

                    {isProcessed && result && (
                      <div className="mt-3 rounded-lg border border-violet-400/25 bg-violet-400/5 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-violet-300">
                            <BrainCircuit className="size-4" aria-hidden />
                            AI-assisted correlation
                          </p>
                          {isCorrelated &&
                            correlationAnalysis !== undefined && (
                              <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-400">
                                <CheckCircle2 className="size-3.5" aria-hidden />
                                Correlated
                              </span>
                            )}
                        </div>

                        {isCorrelating ? (
                          <p
                            role="status"
                            className="mt-2 flex items-center gap-2 text-xs text-violet-300"
                          >
                            <Loader2
                              className="size-3.5 animate-spin"
                              aria-hidden
                            />
                            Correlating…
                          </p>
                        ) : isCorrelationFailed ? (
                          <div
                            role="alert"
                            className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3"
                          >
                            <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-warning">
                              <AlertTriangle className="size-4" aria-hidden />
                              Correlation failed
                            </p>
                            <p className="mt-1.5 text-sm leading-relaxed text-foreground/85">
                              {correlationError?.message ??
                                item.correlation?.error?.message ??
                                "AI correlation is currently unavailable. Preserved evidence remains available."}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-3"
                              onClick={() => onCorrelate(item.id)}
                            >
                              <RotateCcw className="size-3.5" aria-hidden />
                              Try again
                            </Button>
                          </div>
                        ) : isCorrelated && correlationAnalysis ? (
                          <div className="mt-2">
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              {correlationAnalysis.facts.length} evidence-derived
                              facts · {correlationAnalysis.timelineCandidates.length}{" "}
                              timeline candidates ·{" "}
                              {correlationAnalysis.missingInformation.length}{" "}
                              missing ·{" "}
                              {correlationAnalysis.uncertainInformation.length}{" "}
                              uncertain
                            </p>
                            <button
                              type="button"
                              onClick={() => onCorrelate(item.id)}
                              disabled={isCorrelating}
                              className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md disabled:pointer-events-none disabled:opacity-40"
                            >
                              <RotateCcw className="size-3" aria-hidden />
                              Re-correlate
                            </button>
                          </div>
                        ) : (
                          <>
                            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                              Extract traceable facts, timeline candidates, and
                              missing or uncertain information from this
                              extracted text using AI-assisted correlation.
                            </p>
                            <Button
                              type="button"
                              size="sm"
                              className="mt-3"
                              onClick={() => onCorrelate(item.id)}
                            >
                              <BrainCircuit className="size-3.5" aria-hidden />
                              Correlate evidence
                            </Button>
                          </>
                        )}
                      </div>
                    )}

                    {isProcessed && !result && (
                      <p className="mt-3 rounded-lg border border-border/70 bg-background/40 p-3 text-xs leading-relaxed text-muted-foreground">
                        This file was processed in an earlier session. Extracted
                        text is kept in memory only —{" "}
                        {eligible
                          ? "select the file and extract again to view it."
                          : "re-select it to process."}
                      </p>
                    )}
                  </div>

                  {eligible && !isProcessed && !isFailed && (
                    <div className="mt-3">
                      {!fileAvailable && (
                        <p className="mb-2 text-xs leading-relaxed text-warning">
                          File from an earlier session — it needs to be selected
                          again before it can be processed.
                        </p>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => onProcess(item.id)}
                        disabled={!fileAvailable || isProcessing}
                        className={cn(
                          isProcessing && "cursor-wait"
                        )}
                      >
                        {isProcessing ? (
                          <>
                            <Loader2
                              className="size-3.5 animate-spin"
                              aria-hidden
                            />
                            Extracting text…
                          </>
                        ) : (
                          "Process evidence"
                        )}
                      </Button>
                    </div>
                  )}

                  {!eligible && !error && (
                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                      {isPdf(item.mimeType)
                        ? "PDF text extraction is not available yet. The file is preserved, but can't be processed in this version."
                        : isWebp(item.mimeType)
                          ? "WebP isn't supported by the extraction service yet. The file is preserved for a later version."
                          : "This file type can't be processed yet. The file is preserved as evidence."}
                    </p>
                  )}

                  <div
                    className={cn(
                      "mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground",
                      !fileAvailable && eligible && "mt-0 text-warning"
                    )}
                  >
                    {fileAvailable && (
                      <span>
                        {formatBytes(item.size)} · {item.mimeType}
                      </span>
                    )}
                    <span>Captured {formatClock(item.capturedAt)}</span>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}