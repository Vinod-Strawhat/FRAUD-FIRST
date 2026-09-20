"use client";

import { motion } from "framer-motion";
import {
  AlarmSmoke,
  ArrowRight,
  Boxes,
  ClipboardList,
  Repeat,
  type LucideIcon,
} from "lucide-react";

import { Reveal, staggerContainer, staggerItem } from "@/components/motion/reveal";

interface PipelineStage {
  title: string;
  description: string;
  icon: LucideIcon;
}

const STAGES: PipelineStage[] = [
  {
    title: "SCAM",
    description: "Something suspicious just happened. Time to act, calmly and fast.",
    icon: AlarmSmoke,
  },
  {
    title: "PRESERVE",
    description: "Capture screenshots, messages, and transaction references before they're lost.",
    icon: ClipboardList,
  },
  {
    title: "CORRELATE",
    description: "Link scattered evidence into one clear sequence of events.",
    icon: Boxes,
  },
  {
    title: "RESPOND",
    description: "Get guided, correct next steps — 1930, your bank, the cyber-cell.",
    icon: Repeat,
  },
  {
    title: "FOLLOW UP",
    description: "Keep a single structured record as the case moves through channels.",
    icon: ArrowRight,
  },
];

export function IncidentPipeline() {
  return (
    <section id="how-it-works" className="relative scroll-mt-20">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
            How it works
          </span>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            From panic to a structured incident.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            FraudFirst walks you through each stage so nothing important gets
            missed in the first fifteen minutes.
          </p>
        </Reveal>

        <motion.ol
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5"
        >
          {STAGES.map((stage, index) => (
            <motion.li
              key={stage.title}
              variants={staggerItem}
              className="relative rounded-xl border border-border bg-card/40 p-6 transition-colors hover:border-primary/40 hover:bg-card/70"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-background">
                  <stage.icon className="size-5 text-primary" aria-hidden />
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-5 text-sm font-semibold tracking-wide text-foreground">
                {stage.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {stage.description}
              </p>
            </motion.li>
          ))}
        </motion.ol>
      </div>
    </section>
  );
}