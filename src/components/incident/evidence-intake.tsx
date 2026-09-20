"use client";

import type { ChangeEvent } from "react";
import { FilePlus2, ScanLine } from "lucide-react";

import { EVIDENCE_CATEGORY_LABELS } from "@/types";
import type { EvidenceCategory } from "@/types";

const SUPPORTED_CATEGORIES = (Object.keys(
  EVIDENCE_CATEGORY_LABELS
) as EvidenceCategory[]).filter((category) => category !== "unclassified");

interface EvidenceIntakeProps {
  onFiles: (files: File[]) => void;
}

export function EvidenceIntake({ onFiles }: EvidenceIntakeProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      onFiles(Array.from(event.target.files));
    }
    event.target.value = "";
  };

  return (
    <section
      aria-labelledby="evidence-intake-title"
      className="rounded-xl border border-border bg-card/70 p-5"
    >
      <h2
        id="evidence-intake-title"
        className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground"
      >
        Evidence intake
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Select the files you have — screenshots, receipts, messages. They stay
        on this device.
      </p>

      <div className="mt-4">
        <input
          id="evidence-file-input"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,application/pdf,image/*"
          className="peer sr-only"
          onChange={handleChange}
          aria-describedby="evidence-file-hint"
        />
        <label
          htmlFor="evidence-file-input"
          className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background sm:w-auto"
        >
          <FilePlus2 className="size-4" aria-hidden />
          Add evidence
        </label>
        <p id="evidence-file-hint" className="sr-only">
          Opens your file picker. Selected files are kept on this device and
          are not uploaded anywhere.
        </p>
      </div>

      <div className="mt-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Supported categories
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {SUPPORTED_CATEGORIES.map((category) => (
            <li
              key={category}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-2.5 py-1 text-xs text-muted-foreground"
            >
              <ScanLine className="size-3 text-primary/70" aria-hidden />
              {EVIDENCE_CATEGORY_LABELS[category]}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/70">
          FraudFirst classifies evidence automatically in a later step. For
          now, captured evidence is marked Unclassified.
        </p>
      </div>
    </section>
  );
}