"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Siren } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useStartIncident } from "@/hooks/use-start-incident";

export function EmergencyCTA() {
  const reduceMotion = useReducedMotion();
  const startIncident = useStartIncident();

  return (
    <motion.div
      initial={false}
      whileHover={reduceMotion ? undefined : { y: -2 }}
      className="flex w-full max-w-xl flex-col items-center gap-4 sm:flex-row sm:justify-center"
    >
      <Button
        size="lg"
        onClick={startIncident}
        className="h-14 w-full px-8 text-base font-semibold shadow-[0_0_0_1px_rgba(34,211,238,0.25),0_8px_32px_-8px_rgba(34,211,238,0.45)] transition-all duration-200 hover:shadow-[0_0_0_1px_rgba(34,211,238,0.45),0_10px_40px_-8px_rgba(34,211,238,0.6)] sm:w-auto"
      >
        <Siren className="size-5" aria-hidden />
        I&apos;ve Been Scammed
      </Button>

      <Button
        asChild
        size="lg"
        variant="outline"
        className="h-14 w-full px-8 text-base font-medium sm:w-auto"
      >
        <a href="#how-it-works" className="inline-flex items-center gap-2.5">
          See How It Works
          <ArrowRight className="size-4" aria-hidden />
        </a>
      </Button>
    </motion.div>
  );
}