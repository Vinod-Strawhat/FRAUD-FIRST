import Link from "next/link";

import { FraudFirstLogo } from "@/components/brand/fraud-first-logo";

const FOOTER_LINKS = [
  { label: "1930 Cyber Fraud Helpline", href: "#top", external: false },
  { label: "National Cyber Crime Reporting Portal", href: "#top", external: false },
] as const;

const DISCLAIMERS = [
  "FraudFirst does not replace banks, the police, 1930, or the National Cyber Crime Reporting Portal.",
  "It does not recover money, freeze transactions, investigate criminals, or determine guilt.",
  "FraudFirst organizes evidence and guides you to the correct reporting channels.",
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <FraudFirstLogo />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              The incident-response layer for people who just got scammed.
            </p>
          </div>

          <nav aria-label="Footer" className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Reporting channels
            </span>
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="w-fit rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="mt-10 border-t border-border/60 pt-6">
          <ul className="space-y-2">
            {DISCLAIMERS.map((disclaimer) => (
              <li
                key={disclaimer}
                className="text-xs leading-relaxed text-muted-foreground/70"
              >
                {disclaimer}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-xs text-muted-foreground/70">
            © {new Date().getFullYear()} FraudFirst. Demo experience — no real
            incidents are stored.
          </p>
        </div>
      </div>
    </footer>
  );
}