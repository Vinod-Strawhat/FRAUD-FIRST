const PREFIX = "fraudfirst";

export const STORAGE_KEYS = {
  incidents: `${PREFIX}.incidents.v1`,
  activeIncidentId: `${PREFIX}.active-incident-id.v1`,
  evidence: `${PREFIX}.evidence.v1`,
  timeline: `${PREFIX}.timeline.v1`,
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

const isServer = typeof window === "undefined";

export function readStorage<T>(key: StorageKey): T | null {
  if (isServer) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeStorage<T>(key: StorageKey, value: T): void {
  if (isServer) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

export function removeStorage(key: StorageKey): void {
  if (isServer) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    return;
  }
}