/**
 * DEMO / MOCK DATA — UI demonstration only.
 * This data is fictional, clearly labeled as a demo incident,
 * and is NOT connected to any real user, transaction, or account.
 */

export interface DemoTimelineEntry {
  time: string;
  event: string;
  tone: "neutral" | "warn" | "critical" | "info";
}

export interface DemoIncident {
  label: string;
  category: string;
  amount: string;
  elapsed: string;
  status: string;
  evidenceCount: number;
  nextAction: string;
  timeline: DemoTimelineEntry[];
}

export const DEMO_INCIDENT: DemoIncident = {
  label: "DEMO INCIDENT",
  category: "UPI PAYMENT FRAUD",
  amount: "₹24,500",
  elapsed: "4 minutes ago",
  status: "Response in progress",
  evidenceCount: 5,
  nextAction: "Contact 1930",
  timeline: [
    { time: "09:41", event: "Payment initiated", tone: "neutral" },
    { time: "09:42", event: "Payment completed", tone: "neutral" },
    { time: "09:43", event: "Suspicious message received", tone: "warn" },
    { time: "09:44", event: "Incident started", tone: "info" },
  ],
};

export const DEMO_EVIDENCE_FRAGMENTS = [
  { label: "Bank SMS", kind: "message" },
  { label: "UPI screenshot", kind: "image" },
  { label: "WhatsApp message", kind: "chat" },
  { label: "Phone number", kind: "contact" },
  { label: "QR code", kind: "image" },
  { label: "Transaction reference", kind: "reference" },
] as const;