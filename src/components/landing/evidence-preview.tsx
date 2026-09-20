"use client";

import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowRight,
  FolderKanban,
  Link2,
  MessageCircle,
  MessageSquare,
  Phone,
  QrCode,
  ScanLine,
  type LucideIcon,
} from "lucide-react";

import { Reveal, staggerContainer, staggerItem } from "@/components/motion/reveal";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DEMO_EVIDENCE_FRAGMENTS } from "@/lib/demo";

const FRAGMENT_ICONS: Record<string, LucideIcon> = {
  message: MessageSquare,
  image: ScanLine,
  chat: MessageCircle,
  contact: Phone,
  reference: QrCode,
};

export function EvidencePreview() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent"
      />
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Why it matters
          </span>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Don&apos;t lose the evidence while you&apos;re trying to remember
            what happened.
          </h2>
        </Reveal>

        <div className="mt-16 grid items-center gap-8 lg:grid-cols-[1fr_auto_1fr]">
          <Reveal>
            <Card className="border-border/80 bg-card/40">
              <CardContent className="p-5 sm:p-6">
                <div className="mb-5 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">
                    Scattered evidence
                  </h3>
                  <Badge variant="warning">fragmented</Badge>
                </div>
                <motion.div
                  variants={staggerContainer}
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true, margin: "-40px" }}
                  className="flex flex-wrap gap-3"
                >
                  {DEMO_EVIDENCE_FRAGMENTS.map((fragment, index) => {
                    const Icon = FRAGMENT_ICONS[fragment.kind];
                    return (
                      <motion.span
                        key={fragment.label}
                        variants={staggerItem}
                        className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground"
                        style={{ rotate: index % 2 === 0 ? -1 : 1 }}
                      >
                        <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                        {fragment.label}
                      </motion.span>
                    );
                  })}
                </motion.div>
              </CardContent>
            </Card>
          </Reveal>

          <div className="flex justify-center">
            <div className="flex size-12 items-center justify-center rounded-full border border-primary/40 bg-primary/10">
              <ArrowRight
                className="hidden size-5 text-primary lg:block"
                aria-hidden
              />
              <ArrowDown
                className="size-5 text-primary lg:hidden"
                aria-hidden
              />
            </div>
          </div>

          <Reveal delay={0.1}>
            <Card className="border-primary/30 bg-card/60 shadow-[0_24px_60px_-28px_rgba(34,211,238,0.25)]">
              <CardContent className="p-5 sm:p-6">
                <div className="mb-5 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">
                    One structured incident
                  </h3>
                  <Badge variant="outline" className="border-primary/40 text-primary">
                    organized
                  </Badge>
                </div>
                <ul className="space-y-2.5">
                  <li className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2.5">
                    <FolderKanban className="size-4 shrink-0 text-primary" aria-hidden />
                    <span className="text-sm text-foreground">Incident record</span>
                  </li>
                  <li className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2.5">
                    <Link2 className="size-4 shrink-0 text-primary" aria-hidden />
                    <span className="text-sm text-foreground">Linked evidence</span>
                  </li>
                  <li className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2.5">
                    <ScanLine className="size-4 shrink-0 text-primary" aria-hidden />
                    <span className="text-sm text-foreground">Extracted facts</span>
                  </li>
                  <li className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2.5">
                    <Link2 className="size-4 shrink-0 text-primary" aria-hidden />
                    <span className="text-sm text-foreground">Sorted timeline</span>
                  </li>
                  <li className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2.5">
                    <FolderKanban className="size-4 shrink-0 text-primary" aria-hidden />
                    <span className="text-sm text-foreground">Exportable package</span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </Reveal>
        </div>
      </div>
    </section>
  );
}