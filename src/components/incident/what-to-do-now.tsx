import { ListTree } from "lucide-react";

import { cn } from "@/lib/utils";

interface Step {
  title: string;
  note: string;
  primary?: boolean;
}

const STEPS: Step[] = [
  {
    title: "Contact 1930 if money has been transferred",
    note: "Reporting quickly may help authorities and financial institutions respond.",
    primary: true,
  },
  {
    title: "Contact your bank or payment provider",
    note: "Ask about freezing or flagging the account before any further movement.",
  },
  {
    title: "Preserve messages, screenshots and transaction details",
    note: "Add them as evidence below before they disappear or get deleted.",
  },
  {
    title: "Do not delete the conversation or suspicious material",
    note: "Keep originals intact — deleted material cannot be used later.",
  },
];

export function WhatToDoNow() {
  return (
    <section
      aria-labelledby="what-to-do-now-title"
      className="rounded-xl border border-border bg-card/70 p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="what-to-do-now-title"
          className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-primary"
        >
          <ListTree className="size-4" aria-hidden />
          What to do now
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          4 steps
        </span>
      </div>

      <ol className="mt-4 space-y-3">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className={cn(
              "rounded-lg border p-4",
              step.primary
                ? "border-primary/40 bg-primary/10 shadow-[0_0_0_1px_rgba(34,211,238,0.15),0_12px_40px_-16px_rgba(34,211,238,0.35)]"
                : "border-border/70 bg-background/40"
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-md font-mono text-sm font-bold",
                  step.primary
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-background text-muted-foreground"
                )}
                aria-hidden
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug text-foreground">
                  {step.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {step.note}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-4 border-t border-border/70 pt-3 text-xs leading-relaxed text-muted-foreground">
        These are guidance steps. FraudFirst does not place these calls or
        actions for you.
      </p>
    </section>
  );
}