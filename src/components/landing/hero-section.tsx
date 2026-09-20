"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

import { EmergencyCTA } from "@/components/landing/emergency-cta";
import { staggerContainer, staggerItem } from "@/components/motion/reveal";
import { Badge } from "@/components/ui/badge";

export function HeroSection() {
  return (
    <section id="top" className="relative overflow-hidden">
      <div
        aria-hidden
        className="hero-grid pointer-events-none absolute inset-x-0 top-0 h-full"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_50%_-5%,rgba(34,211,238,0.16),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-[-10%] size-[28rem] rounded-full bg-primary/5 blur-3xl"
      />

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-6 pb-20 pt-20 text-center sm:pb-28 sm:pt-28"
      >
        <motion.div variants={staggerItem}>
          <Badge
            variant="secondary"
            className="border-primary/20 font-mono text-[11px] uppercase tracking-[0.2em]"
          >
            Incident response for scam victims
          </Badge>
        </motion.div>

        <motion.h1
          variants={staggerItem}
          className="mt-7 max-w-3xl text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-foreground sm:text-6xl"
        >
          The first 15 minutes after a{" "}
          <span className="text-primary">scam</span> matter.
        </motion.h1>

        <motion.p
          variants={staggerItem}
          className="mt-6 max-w-2xl text-lg text-pretty text-muted-foreground sm:text-xl"
        >
          FraudFirst helps you preserve what happened, organize the evidence,
          and follow the right next steps.
        </motion.p>

        <motion.div variants={staggerItem} className="mt-10">
          <EmergencyCTA />
        </motion.div>

        <motion.p
          variants={staggerItem}
          className="mt-5 flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <ArrowRight className="size-4 text-primary" aria-hidden />
          Start an incident response in under a minute.
        </motion.p>
      </motion.div>
    </section>
  );
}