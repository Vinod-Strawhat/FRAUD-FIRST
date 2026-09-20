import type { PersistenceStatus } from "@/types";

const STATUS_LABELS: Record<PersistenceStatus, string> = {
  local: "Local session",
  syncing: "Syncing…",
  synced: "AWS synced",
  unavailable: "Sync unavailable",
};

const STATUS_DOT_CLASSES: Record<PersistenceStatus, string> = {
  local: "bg-muted-foreground/60",
  syncing: "bg-amber-400",
  synced: "bg-emerald-400",
  unavailable: "bg-warning",
};

const STATUS_TEXT_CLASSES: Record<PersistenceStatus, string> = {
  local: "text-muted-foreground",
  syncing: "text-foreground/80",
  synced: "text-emerald-400",
  unavailable: "text-warning",
};

interface PersistenceStatusProps {
  status: PersistenceStatus;
}

export function PersistenceStatus({ status }: PersistenceStatusProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${STATUS_DOT_CLASSES[status]}`}
      />
      <span
        className={`font-mono text-[10px] font-semibold uppercase tracking-[0.16em] ${STATUS_TEXT_CLASSES[status]}`}
      >
        {STATUS_LABELS[status]}
      </span>
    </span>
  );
}