"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ShieldAlert } from "lucide-react";

import { Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { useStartIncident } from "@/hooks/use-start-incident";

export function FinalCta() {
  const reduceMotion = useReducedMotion();
  const startIncident = useStartIncident();

  return (
    <section id="respond" className="relative scroll-mt-20 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_50%_at_50%_100%,rgba(34,211,238,0.12),transparent)]"
      />
      <div className="mx-auto w-full max-w-6xl px-6 py-24 sm:py-32">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">
            <ShieldAlert className="size-4" aria-hidden />
            You&apos;re not on your own here
          </span>
          <h2 className="mt-6 text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Something just happened?
          </h2>
          <p className="mt-5 text-lg text-muted-foreground">
            Start organizing the incident. The next few minutes decide how much
            of the evidence survives.
          </p>
          <motion.div
            initial={false}
            whileHover={reduceMotion ? undefined : { y: -2 }}
            className="mt-10"
          >
            <Button
              size="lg"
              onClick={startIncident}
              className="h-14 px-9 text-base font-semibold shadow-[0_0_0_1px_rgba(34,211,238,0.25),0_10px_40px_-10px_rgba(34,211,238,0.5)] transition-shadow hover:shadow-[0_0_0_1px_rgba(34,211,238,0.45),0_14px_50px_-10px_rgba(34,211,238,0.65)]"
            >
              Start Incident Response
            </Button>
          </motion.div>
          <p className="mt-5 text-sm text-muted-foreground">
            Free · No account needed · Takes about a minute
          </p>
        </Reveal>
      </div>
    </section>
  );
}