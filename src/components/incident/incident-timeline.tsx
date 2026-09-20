"use client";

import { AnimatePresence, motion } from "framer-motion";

import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { IncidentTimelineEvent, TimelineTone } from "@/types";

const TONE_DOT: Record<TimelineTone, string> = {
  critical: "bg-destructive",
  warn: "bg-warning",
  info: "bg-primary",
  neutral: "bg-foreground/40",
};

interface IncidentTimelineProps {
  timeline: IncidentTimelineEvent[];
}

export function IncidentTimeline({ timeline }: IncidentTimelineProps) {
  const count = timeline.length;

  return (
    <section
      aria-labelledby="timeline-title"
      className="rounded-xl border border-border bg-card/70 p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="timeline-title"
          className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground"
        >
          Incident timeline
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          {count} {count === 1 ? "event" : "events"}
        </span>
      </div>

      <ol className="mt-4">
        <AnimatePresence initial={false}>
          {timeline.map((event) => (
            <motion.li
              key={event.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="relative flex items-start gap-3 border-l border-border/80 pb-3 pl-4 last:pb-0"
            >
              <span
                aria-hidden
                className={cn(
                  "absolute -left-[5px] top-1.5 size-2 rounded-full",
                  TONE_DOT[event.tone]
                )}
              />
              <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                {formatClock(event.occurredAt)}
              </span>
              <span className="min-w-0">
                <span className="block text-sm text-foreground">
                  {event.label}
                </span>
                {event.detail && (
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {event.detail}
                  </span>
                )}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </section>
  );
}