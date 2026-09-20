"use client";

import { motion } from "framer-motion";
import {
  EyeOff,
  FileLock2,
  Scale,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

import { Reveal, staggerContainer, staggerItem } from "@/components/motion/reveal";

interface TrustPoint {
  title: string;
  body: string;
  icon: LucideIcon;
}

const TRUST_POINTS: TrustPoint[] = [
  {
    title: "Your evidence stays yours",
    body: "Evidence is organized for you — access and control remain with you at all times.",
    icon: FileLock2,
  },
  {
    title: "Original files are preserved",
    body: "FraudFirst keeps originals intact and organizes them into a structured record.",
    icon: EyeOff,
  },
  {
    title: "We organize, we don't decide",
    body: "FraudFirst structures what happened. It does not determine guilt or blame.",
    icon: Scale,
  },
  {
    title: "We guide you to the right channels",
    body: "Referral to 1930, your bank, and the National Cyber Crime Reporting Portal — never instead of them.",
    icon: Waypoints,
  },
];

export function TrustSection() {
  return (
    <section id="privacy" className="relative scroll-mt-20">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Trust &amp; privacy
          </span>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Built for your situation, not for someone else&apos;s.
          </h2>
        </Reveal>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          {TRUST_POINTS.map((point) => (
            <motion.div
              key={point.title}
              variants={staggerItem}
              className="rounded-xl border border-border bg-card/40 p-6 transition-colors hover:border-primary/40 hover:bg-card/70"
            >
              <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-background">
                <point.icon className="size-5 text-primary" aria-hidden />
              </span>
              <h3 className="mt-5 text-sm font-semibold text-foreground">
                {point.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {point.body}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}