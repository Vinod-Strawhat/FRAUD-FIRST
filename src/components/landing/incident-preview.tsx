"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Banknote,
  Clock,
  FileSearch,
  PhoneCall,
} from "lucide-react";

import { Reveal } from "@/components/motion/reveal";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DEMO_INCIDENT } from "@/lib/demo";
import { cn } from "@/lib/utils";

const TONE_CLASS = {
  neutral: "text-foreground",
  warn: "text-warning",
  critical: "text-destructive",
  info: "text-primary",
} as const;

export function IncidentPreview() {
  const reduceMotion = useReducedMotion();

  return (
    <Reveal className="w-full max-w-6xl">
      <div className="mx-auto max-w-2xl">
        <Card className="overflow-hidden border-border/80 bg-card/60 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.8)] backdrop-blur">
          <div className="flex items-center justify-between border-b border-border/80 bg-background/40 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="rounded border border-warning/40 bg-warning/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-warning">
                {DEMO_INCIDENT.label}
              </span>
              <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                {DEMO_INCIDENT.category}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-emerald-400">
              <span
                className="relative flex size-1.5"
                aria-hidden
              >
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
              </span>
              LIVE
            </div>
          </div>

          <CardContent className="p-5 sm:p-6">
            <div className="grid gap-5 sm:grid-cols-[1.2fr_1fr]">
              <div>
                <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Incident
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="text-2xl font-semibold tracking-tight text-foreground">
                    {DEMO_INCIDENT.amount}
                  </h3>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3.5" aria-hidden />
                    {DEMO_INCIDENT.elapsed}
                  </span>
                </div>

                <div className="mt-5 space-y-3">
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/50 px-3 py-2.5">
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <FileSearch className="size-4 text-primary" aria-hidden />
                      Status
                    </span>
                    <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">
                      {DEMO_INCIDENT.status}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/50 px-3 py-2.5">
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Banknote className="size-4 text-primary" aria-hidden />
                      Evidence captured
                    </span>
                    <span className="font-mono text-sm text-foreground">
                      {DEMO_INCIDENT.evidenceCount}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5">
                    <span className="flex items-center gap-2 text-xs text-warning">
                      <PhoneCall className="size-4" aria-hidden />
                      Next action
                    </span>
                    <span className="text-sm font-medium text-warning">
                      {DEMO_INCIDENT.nextAction}
                    </span>
                  </div>
                </div>
              </div>

              <div className="border-t border-border/70 pt-5 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                <p className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  <AlertTriangle className="size-3.5 text-warning" aria-hidden />
                  Timeline
                </p>
                <ol className="mt-3 space-y-0">
                  {DEMO_INCIDENT.timeline.map((entry) => (
                    <li
                      key={entry.time + entry.event}
                      className={cn(
                        "relative flex items-start gap-3 border-l border-border pb-3 pl-4 last:pb-0",
                      )}
                    >
                      <span
                        aria-hidden
                        className="absolute -left-[5px] top-1 size-2 rounded-full bg-primary/70"
                      />
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {entry.time}
                      </span>
                      <span className={cn("text-sm", TONE_CLASS[entry.tone])}>
                        {entry.event}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: reduceMotion ? 0 : 0.8, duration: 0.5 }}
              className="mt-5 border-t border-border/70 pt-4 text-xs text-muted-foreground"
            >
              This is a fictional demo incident used to show what an active
              case looks like. It does not represent a real scam.
            </motion.p>
          </CardContent>
        </Card>
      </div>
    </Reveal>
  );
}