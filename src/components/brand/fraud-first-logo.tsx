import { ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

interface FraudFirstLogoProps {
  className?: string;
  iconClassName?: string;
}

export function FraudFirstLogo({
  className,
  iconClassName,
}: FraudFirstLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="flex size-8 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
        <ShieldCheck className={cn("size-4.5 text-primary", iconClassName)} />
      </span>
      <span className="text-sm font-semibold tracking-tight text-foreground">
        FraudFirst
      </span>
    </span>
  );
}