const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatElapsed(totalSeconds: number, padHours = false): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  const mm = pad2(minutes);
  const ss = pad2(seconds);
  return hours > 0 || padHours ? `${pad2(hours)}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "\u2014";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} \u00b7 ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

export function formatStartedAgo(iso: string, nowMs: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Started just now";
  const minutes = Math.max(0, Math.floor((nowMs - d.getTime()) / 60000));
  if (minutes < 1) return "Started just now";
  if (minutes < 60) {
    return minutes === 1
      ? "Started 1 minute ago"
      : `Started ${minutes} minutes ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? "Started 1 hour ago" : `Started ${hours} hours ago`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? "Started 1 day ago" : `Started ${days} days ago`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}