import type {
  CorrelationAnalysis,
  ContactPoint,
  EvidenceDerivedFact,
  EvidenceUrl,
  IdentifierReference,
  MissingInformation,
  TimelineCandidate,
  UncertainInformation,
} from "@/types";

export interface LocalCorrelateInput {
  evidenceId: string;
  text: string;
}

export interface LocalCorrelateResult {
  modelId: string;
  durationMs: number;
  textLength: number;
  analysis: CorrelationAnalysis;
}

const MODEL_ID = "local-deterministic-v1";

function normalizeAmount(raw: string): string {
  const cleaned = raw.replace(/[,\s]/g, "");
  const num = parseFloat(cleaned);
  if (isNaN(num)) return "";
  return num.toString();
}

function extractAmounts(text: string): Array<{ raw: string; normalized: string; unit: string }> {
  const results: Array<{ raw: string; normalized: string; unit: string }> = [];
  const seen = new Set<string>();

  // ₹ / Rs. / INR patterns
  const inrRe = /(?:₹|Rs\.?|INR)\s*(\d[\d,]*\.?\d*)/gi;
  let m: RegExpExecArray | null;
  while ((m = inrRe.exec(text)) !== null) {
    const raw = m[0].trim();
    const normalized = normalizeAmount(m[1]);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      results.push({ raw, normalized, unit: "INR" });
    }
  }

  // $ patterns
  const usdRe = /\$\s*(\d[\d,]*\.?\d*)/g;
  while ((m = usdRe.exec(text)) !== null) {
    const raw = m[0].trim();
    const normalized = normalizeAmount(m[1]);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      results.push({ raw, normalized, unit: "USD" });
    }
  }

  return results;
}

function extractUTRs(text: string): Array<{ raw: string; value: string }> {
  const results: Array<{ raw: string; value: string }> = [];
  const seen = new Set<string>();
  const re = /(?:UPI\s*Ref(?:erence)?|UTR|TXN\s*ID|Transaction\s*ID|Ref(?:erence)?\s*No\.?)\s*[:=]?\s*([A-Za-z0-9]{6,30})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = m[1].trim();
    const lower = value.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      results.push({ raw: m[0].trim(), value });
    }
  }
  return results;
}

function extractUPIIds(text: string): Array<{ raw: string; value: string }> {
  const results: Array<{ raw: string; value: string }> = [];
  const seen = new Set<string>();
  const re = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = m[1].trim();
    const lower = value.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      results.push({ raw: m[0].trim(), value });
    }
  }
  return results;
}

function extractPhones(text: string): Array<{ raw: string; value: string }> {
  const results: Array<{ raw: string; value: string }> = [];
  const seen = new Set<string>();
  const re = /(?:\+91[-\s]?)?(\d{10})|(?:\+91[-\s]?|91[-\s]?)(\d{10})|(?:\+91[-\s]?)(\d{10})/g;
  // Simpler: match 10-digit Indian mobile numbers
  const re2 = /(\+91[-\s]?\d{10}|91[-\s]?\d{10}|\d{10})/g;
  let m: RegExpExecArray | null;
  while ((m = re2.exec(text)) !== null) {
    const raw = m[0].trim();
    // Normalize to 10 digits
    const digits = raw.replace(/[^0-9]/g, "");
    let value: string;
    if (digits.length === 12 && digits.startsWith("91")) {
      value = digits.slice(2);
    } else if (digits.length === 10) {
      value = digits;
    } else {
      continue;
    }
    // Must start with 6-9
    if (!/^[6-9]/.test(value)) continue;
    if (!seen.has(value)) {
      seen.add(value);
      results.push({ raw, value });
    }
  }
  return results;
}

function extractDates(text: string): Array<{ raw: string; value: string }> {
  const results: Array<{ raw: string; value: string }> = [];
  const seen = new Set<string>();

  // YYYY-MM-DD
  const isoRe = /\b(\d{4}-\d{2}-\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = isoRe.exec(text)) !== null) {
    const raw = m[0].trim();
    const d = new Date(m[1]);
    if (!isNaN(d.getTime()) && !seen.has(raw)) {
      seen.add(raw);
      results.push({ raw, value: d.toISOString().slice(0, 10) });
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyRe = /\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/g;
  while ((m = dmyRe.exec(text)) !== null) {
    const raw = m[0].trim();
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    const d = new Date(year, month - 1, day);
    if (
      !isNaN(d.getTime()) &&
      d.getFullYear() === year &&
      d.getMonth() === month - 1 &&
      d.getDate() === day &&
      !seen.has(raw)
    ) {
      seen.add(raw);
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      results.push({ raw, value: iso });
    }
  }

  // "20 Sep 2026" format
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const monthShort = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const textualRe = /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\b/gi;
  while ((m = textualRe.exec(text)) !== null) {
    const raw = m[0].trim();
    const day = parseInt(m[1], 10);
    const monthStr = m[2].toLowerCase();
    const year = parseInt(m[3], 10);
    const mi =
      monthShort.findIndex((s) => s.toLowerCase() === monthStr);
    if (mi >= 0) {
      const d = new Date(year, mi, day);
      if (!isNaN(d.getTime()) && !seen.has(raw)) {
        seen.add(raw);
        const iso = `${year}-${String(mi + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        results.push({ raw, value: iso });
      }
    }
  }

  return results;
}

function extractTimes(text: string): Array<{ raw: string; value: string }> {
  const results: Array<{ raw: string; value: string }> = [];
  const seen = new Set<string>();

  // HH:MM AM/PM
  const ampmRe = /\b(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))\b/g;
  let m: RegExpExecArray | null;
  while ((m = ampmRe.exec(text)) !== null) {
    const raw = m[0].trim();
    if (!seen.has(raw)) {
      seen.add(raw);
      results.push({ raw, value: raw });
    }
  }

  // HH:MM (24h) without AM/PM already matched
  const h24Re = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
  while ((m = h24Re.exec(text)) !== null) {
    const raw = m[0].trim();
    if (!seen.has(raw)) {
      seen.add(raw);
      results.push({ raw, value: raw });
    }
  }

  return results;
}

function extractURLs(text: string): Array<{ raw: string; value: string }> {
  const results: Array<{ raw: string; value: string }> = [];
  const seen = new Set<string>();
  const re = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let value = m[0].trim().replace(/[.,;:!?)]+$/, "");
    if (!seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      results.push({ raw: m[0].trim(), value });
    }
  }
  return results;
}

function extractEmails(text: string): Array<{ raw: string; value: string }> {
  const results: Array<{ raw: string; value: string }> = [];
  const seen = new Set<string>();
  const re = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = m[1].toLowerCase();
    if (!seen.has(value)) {
      seen.add(value);
      results.push({ raw: m[0].trim(), value });
    }
  }
  return results;
}

interface ExtractedItem {
  type: "amount" | "utr" | "upi_id" | "phone" | "url" | "email";
  value: string;
  unit?: string;
  raw: string;
  normalizedKey: string;
}

interface DateItem {
  raw: string;
  isoDate: string;
}

interface TimeItem {
  raw: string;
  timeValue: string;
}

function extractFromEvidence(
  evidenceId: string,
  text: string
): { items: ExtractedItem[]; dates: DateItem[]; times: TimeItem[] } {
  const items: ExtractedItem[] = [];
  const dates: DateItem[] = [];
  const times: TimeItem[] = [];

  for (const a of extractAmounts(text)) {
    items.push({
      type: "amount",
      value: a.normalized,
      unit: a.unit,
      raw: a.raw,
      normalizedKey: `amount:${a.unit}:${a.normalized}`,
    });
  }

  for (const u of extractUTRs(text)) {
    items.push({
      type: "utr",
      value: u.value,
      raw: u.raw,
      normalizedKey: `utr:${u.value.toLowerCase()}`,
    });
  }

  for (const u of extractUPIIds(text)) {
    items.push({
      type: "upi_id",
      value: u.value,
      raw: u.raw,
      normalizedKey: `upi:${u.value.toLowerCase()}`,
    });
  }

  for (const p of extractPhones(text)) {
    items.push({
      type: "phone",
      value: p.value,
      raw: p.raw,
      normalizedKey: `phone:${p.value}`,
    });
  }

  for (const u of extractURLs(text)) {
    items.push({
      type: "url",
      value: u.value,
      raw: u.raw,
      normalizedKey: `url:${u.value.toLowerCase()}`,
    });
  }

  for (const e of extractEmails(text)) {
    items.push({
      type: "email",
      value: e.value,
      raw: e.raw,
      normalizedKey: `email:${e.value.toLowerCase()}`,
    });
  }

  for (const d of extractDates(text)) {
    dates.push({ raw: d.raw, isoDate: d.value });
  }

  for (const t of extractTimes(text)) {
    times.push({ raw: t.raw, timeValue: t.value });
  }

  return { items, dates, times };
}

function confidenceForType(type: ExtractedItem["type"]): number {
  switch (type) {
    case "amount":
    case "utr":
    case "upi_id":
    case "phone":
      return 0.95;
    case "url":
    case "email":
      return 0.85;
    default:
      return 0.95;
  }
}

function factTypeLabel(type: ExtractedItem["type"]): string {
  switch (type) {
    case "amount":
      return "transaction_amount";
    case "utr":
      return "utr";
    case "upi_id":
      return "upi_id";
    case "phone":
      return "phone_number";
    case "url":
      return "url";
    case "email":
      return "email";
  }
}

const MISSING_FIELDS: MissingInformation[] = [
  { field: "bank_name", reason: "Not deterministically extractable from OCR text without context" },
  { field: "sender_name", reason: "Not deterministically extractable from OCR text without context" },
  { field: "recipient_name", reason: "Not deterministically extractable from OCR text without context" },
  { field: "account_number", reason: "Not deterministically extractable from OCR text without context" },
];

export function correlateLocally(items: LocalCorrelateInput[]): LocalCorrelateResult {
  const start = performance.now();

  // Merge across evidence: normalizedKey → { value, unit?, raw, evidenceIds }
  const merged = new Map<string, { type: ExtractedItem["type"]; value: string; unit?: string; raw: string; evidenceIds: string[] }>();
  // Track all raw texts per evidence for sourceText of facts
  const rawPerEvidence = new Map<string, Map<string, string>>(); // evidenceId → (normalizedKey → raw text)

  // Collect all dates and times per evidence for timeline
  const allDates: Array<{ evidenceId: string; raw: string; isoDate: string }> = [];
  const allTimes: Array<{ evidenceId: string; raw: string; timeValue: string }> = [];

  for (const item of items) {
    const { items: extracted, dates, times } = extractFromEvidence(item.evidenceId, item.text);
    const evidenceRawMap = new Map<string, string>();

    for (const ex of extracted) {
      evidenceRawMap.set(ex.normalizedKey, ex.raw);
      const existing = merged.get(ex.normalizedKey);
      if (existing) {
        if (!existing.evidenceIds.includes(item.evidenceId)) {
          existing.evidenceIds.push(item.evidenceId);
        }
      } else {
        merged.set(ex.normalizedKey, {
          type: ex.type,
          value: ex.value,
          unit: ex.unit,
          raw: ex.raw,
          evidenceIds: [item.evidenceId],
        });
      }
    }

    for (const d of dates) {
      allDates.push({ evidenceId: item.evidenceId, raw: d.raw, isoDate: d.isoDate });
    }
    for (const t of times) {
      allTimes.push({ evidenceId: item.evidenceId, raw: t.raw, timeValue: t.timeValue });
    }

    rawPerEvidence.set(item.evidenceId, evidenceRawMap);
  }

  // Build facts
  const facts: EvidenceDerivedFact[] = [];
  for (const entry of Array.from(merged.values())) {
    facts.push({
      type: factTypeLabel(entry.type),
      value: entry.value,
      unit: entry.unit,
      confidence: confidenceForType(entry.type),
      sourceEvidenceIds: entry.evidenceIds,
      sourceText: entry.raw,
    });
  }

  // Build identifiers (UTR + UPI)
  const identifiers: IdentifierReference[] = [];
  for (const entry of Array.from(merged.values())) {
    if (entry.type === "utr" || entry.type === "upi_id") {
      identifiers.push({
        type: entry.type === "utr" ? "utr" : "upi_id",
        value: entry.value,
        sourceEvidenceIds: entry.evidenceIds,
      });
    }
  }

  // Build contact points
  const contactPoints: ContactPoint[] = [];
  for (const entry of Array.from(merged.values())) {
    if (entry.type === "phone") {
      contactPoints.push({
        type: "phone",
        value: entry.value,
        sourceEvidenceIds: entry.evidenceIds,
      });
    }
  }

  // Build URLs
  const urls: EvidenceUrl[] = [];
  for (const entry of Array.from(merged.values())) {
    if (entry.type === "url") {
      urls.push({
        value: entry.value,
        sourceEvidenceIds: entry.evidenceIds,
      });
    }
  }

  // Build timeline candidates from dates + times
  // Group dates by evidence, pair with times from same evidence
  const timelineCandidates: TimelineCandidate[] = [];
  const processedDates = new Set<string>();

  for (const dateEntry of allDates) {
    const dateKey = dateEntry.isoDate;
    if (processedDates.has(dateKey)) continue;
    processedDates.add(dateKey);

    // Find matching time from same evidence
    const matchingTime = allTimes.find((t) => t.evidenceId === dateEntry.evidenceId);
    let timestamp: string | null;
    if (matchingTime) {
      // Combine date + time into ISO 8601
      timestamp = `${dateEntry.isoDate}T${normalizeTimeForISO(matchingTime.timeValue)}:00`;
    } else {
      timestamp = dateEntry.isoDate;
    }

    // Gather all evidence IDs that have this same date
    const dateEvidenceIds = allDates
      .filter((d) => d.isoDate === dateKey)
      .map((d) => d.evidenceId);

    timelineCandidates.push({
      timestamp,
      event: "Transaction date from evidence",
      sourceEvidenceIds: Array.from(new Set(dateEvidenceIds)),
      confidence: 0.95,
      label: "CONFIRMED FROM EVIDENCE",
    });
  }

  const totalTextLength = items.reduce((sum, item) => sum + item.text.length, 0);

  const analysis: CorrelationAnalysis = {
    facts,
    timelineCandidates,
    identifiers,
    contactPoints,
    urls,
    missingInformation: MISSING_FIELDS,
    uncertainInformation: [],
  };

  const durationMs = Math.round(performance.now() - start);

  return {
    modelId: MODEL_ID,
    durationMs,
    textLength: totalTextLength,
    analysis,
  };
}

function normalizeTimeForISO(timeStr: string): string {
  const trimmed = timeStr.trim();
  const ampmMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/i);
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[1], 10);
    const min = ampmMatch[2];
    const period = ampmMatch[3].toUpperCase();
    if (period === "PM" && hour !== 12) hour += 12;
    if (period === "AM" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${min}`;
  }
  return trimmed;
}
