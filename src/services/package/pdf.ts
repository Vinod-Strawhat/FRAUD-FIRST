import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { IncidentPackageMeta } from "@/types/package";

export const PACKAGE_PDF_TITLE_LINE = "FraudFirst Incident Evidence Package";
export const PACKAGE_PDF_FILENAME_PREFIX = "FraudFirst-";

export const PACKAGE_PDF_SECTION_HEADINGS = [
  "1. INCIDENT SUMMARY",
  "2. WHAT HAPPENED",
  "3. INCIDENT TIMELINE",
  "4. IDENTIFIERS & CONTACT POINTS",
  "5. FINANCIAL REFERENCES",
  "6. RESPONSE STATUS",
  "7. EVIDENCE INDEX",
  "8. INTEGRITY & PRESERVATION",
  "9. MISSING INFORMATION",
  "10. UNCERTAIN INFORMATION",
  "11. SOURCE EVIDENCE REFERENCES",
  "12. DISCLAIMER",
] as const;

export const INTELLIGENCE_UNAVAILABLE_PDF_NOTE =
  "Incident intelligence was not available when this package was generated. " +
  "This package lists preserved evidence and incident metadata only; nothing has been inferred or invented.";

const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;
const PDF_MARGIN = 50;
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
const PDF_BODY_SIZE = 9.5;
const PDF_TITLE_SIZE = 17;
const PDF_HEADING_SIZE = 11.5;
const PDF_LINE_SPACING = 1.5;

export interface PdfContentLine {
  kind: "title" | "heading" | "body";
  text: string;
}

/**
 * Sanitizes arbitrary text so it is safe to draw into a PDF page: drops
 * control characters, normalises whitespace and removes surrounding padding.
 * The package builder never has secrets, credentials or raw provider output to
 * pass through this path, so this is a belt-and-braces guard rather than a
 * content source.
 */
export function sanitizePdfText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? value : String(value);
  return (
    raw
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .trim()
  );
}

function toPdfLine(text: string, kind: PdfContentLine["kind"] = "body"): PdfContentLine {
  if (kind === "body" && text === "") {
    return { kind, text: "" };
  }
  return { kind, text: sanitizePdfText(text) };
}

/** Builds the exact text content of the package PDF as a line stream. */
export function buildPdfTextContent(pkg: IncidentPackageMeta): PdfContentLine[] {
  const lines: PdfContentLine[] = [];
  const body = (text: string) => lines.push(toPdfLine(text, "body"));
  const heading = (text: string) => lines.push(toPdfLine(text, "heading"));
  const brief = pkg.intelligence.available ? pkg.intelligence.brief : null;

  lines.push(toPdfLine(PACKAGE_PDF_TITLE_LINE, "title"));
  body(`Incident ${pkg.incident.incidentId}`);
  body("");

  heading(PACKAGE_PDF_SECTION_HEADINGS[0]);
  body(`Type: ${pkg.incident.typeLabel}`);
  body(`Status: ${pkg.incident.statusLabel}`);
  body(`Started: ${pkg.incident.startedAt}`);
  body(`Last updated: ${pkg.incident.updatedAt}`);
  body(`Reported amount: ${pkg.incident.amount ?? "Not specified"}`);
  body(`Package generated at: ${pkg.generatedAt}`);
  body("");

  heading(PACKAGE_PDF_SECTION_HEADINGS[1]);
  if (brief) {
    body(brief.summary);
  } else {
    body(INTELLIGENCE_UNAVAILABLE_PDF_NOTE);
  }
  body("");

  heading(PACKAGE_PDF_SECTION_HEADINGS[2]);
  if (brief && brief.timeline.length > 0) {
    for (const event of brief.timeline) {
      body(`${event.timestamp ?? "unknown"} | ${event.event}`);
    }
  } else {
    body(brief ? "No analysis timeline entries." : "Analysis timeline unavailable.");
  }
  body("Incident event log:");
  for (const event of pkg.timeline) {
    const detail = event.detail ? ` | ${event.detail}` : "";
    body(`${event.occurredAt} | ${event.label}${detail}`);
  }
  body("");

  heading(PACKAGE_PDF_SECTION_HEADINGS[3]);
  if (brief) {
    for (const identifier of brief.identifiers) {
      body(`${identifier.type}: ${identifier.value}`);
    }
    for (const contact of brief.contactPoints) {
      body(`Contact (${contact.type}): ${contact.value}`);
    }
  } else {
    body(INTELLIGENCE_UNAVAILABLE_PDF_NOTE);
  }
  body("");

  heading(PACKAGE_PDF_SECTION_HEADINGS[4]);
  if (brief && brief.financialReferences.length > 0) {
    for (const reference of brief.financialReferences) {
      body(`${reference.type}: ${reference.value}`);
    }
  } else {
    body(brief && brief.financialReferences.length === 0
      ? "No financial references recorded."
      : INTELLIGENCE_UNAVAILABLE_PDF_NOTE);
  }
  body("");

  heading(PACKAGE_PDF_SECTION_HEADINGS[5]);
  if (!pkg.response.started) {
    body("Response plan: NOT STARTED");
  } else {
    body(`Response plan: ${pkg.response.status.toUpperCase()}`);
    for (const action of pkg.response.actions) {
      const completed = action.completedAt ? ` - completed ${action.completedAt}` : "";
      body(`${action.order}. ${action.title}: ${action.status.toUpperCase()}${completed}`);
    }
    if (pkg.response.liveExecution && pkg.response.executionStatus) {
      body(`Live execution status: ${pkg.response.executionStatus}`);
    }
  }
  body("");

  heading(PACKAGE_PDF_SECTION_HEADINGS[6]);
  for (const entry of pkg.evidenceIndex) {
    body(`${entry.evidenceId} | ${entry.originalFilename}`);
    body(`- ${entry.categoryLabel} | MIME ${entry.mimeType} | ${entry.size} bytes | captured ${entry.capturedAt}`);
    body(`- Preservation: ${entry.preserved ? "PRESERVED" : entry.storageStatus.toUpperCase()}`);
  }
  body("");

  heading(PACKAGE_PDF_SECTION_HEADINGS[7]);
  body(`Preserved evidence: ${pkg.integrity.preservedCount} of ${pkg.evidenceIndex.length}`);
  body(`Unpreserved evidence: ${pkg.integrity.unpreservedCount}`);
  body(pkg.integrity.hashesIncluded
    ? "SHA-256 fingerprints: included"
    : "SHA-256 fingerprints: not recorded");
  body(pkg.integrity.preservedOriginalsReferenced
    ? "Preserved originals: referenced by storage metadata"
    : "Preserved originals: not referenced");
  body(pkg.integrity.objectLock
    ? "Object lock: active"
    : "Object lock: not applied or claimed");
  body("");
  body("Integrity notes:");
  body("- SHA-256 fingerprints are taken from the preservation record and are never recomputed here.");
  body("- Storage references identify preserved originals through persisted metadata only.");
  body("- The package is a point-in-time snapshot; later changes are not represented.");
  body("");

  heading(PACKAGE_PDF_SECTION_HEADINGS[8]);
  if (brief && brief.missingInformation.length > 0) {
    for (const missing of brief.missingInformation) {
      body(`${missing.field}: ${missing.reason}`);
    }
  } else {
    body(brief && brief.missingInformation.length === 0
      ? "No missing information recorded."
      : INTELLIGENCE_UNAVAILABLE_PDF_NOTE);
  }
  body("");

  heading(PACKAGE_PDF_SECTION_HEADINGS[9]);
  if (brief && brief.uncertainInformation.length > 0) {
    for (const uncertain of brief.uncertainInformation) {
      body(`${uncertain.field}: ${uncertain.reason}`);
    }
  } else {
    body(brief && brief.uncertainInformation.length === 0
      ? "No uncertain information recorded."
      : INTELLIGENCE_UNAVAILABLE_PDF_NOTE);
  }
  body("");

  heading(PACKAGE_PDF_SECTION_HEADINGS[10]);
  if (brief) {
    body("Analysis items reference the following source evidence ids from the index above:");
    body(brief.sourceEvidenceIds.join(", "));
  } else {
    body(INTELLIGENCE_UNAVAILABLE_PDF_NOTE);
  }
  body("");

  heading(PACKAGE_PDF_SECTION_HEADINGS[11]);
  body(pkg.disclaimer);

  return lines;
}

/**
 * Wraps text to a maximum width measured with the given font, preserving line
 * breaks. Oversized tokens (which cannot fit on a single line) are hard-broken
 * so the document always renders within its page.
 */
export function wrapPdfText(
  text: string,
  maxWidth: number,
  size: number,
  font: PDFFont
): string[] {
  const sanitized = sanitizePdfText(text);
  const hardLimit = Math.floor(maxWidth / size);
  const lines: string[] = [];
  const pushLine = (line: string) => lines.push(line.trim());
  const pushHard = (word: string) => {
    while (word.length > hardLimit) {
      pushLine(word.slice(0, hardLimit));
      word = word.slice(hardLimit);
    }
    return word;
  };

  const paragraphs = sanitized.split("\n");
  for (const paragraph of paragraphs) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || current === "") {
        current = candidate;
      } else {
        const remainder = pushHard(current);
        if (remainder) {
          pushLine(remainder);
        }
        current = word;
      }
    }
    let remainder = current;
    while (remainder.length > hardLimit) {
      pushLine(remainder.slice(0, hardLimit));
      remainder = remainder.slice(hardLimit);
    }
    if (remainder) {
      pushLine(remainder);
    } else {
      lines.push("");
    }
  }
  return lines;
}

class PdfWriter {
  private readonly doc: PDFDocument;
  private readonly helv: PDFFont;
  private readonly helvBold: PDFFont;
  private page: PDFPage;
  private y: number;

  constructor(doc: PDFDocument, helv: PDFFont, helvBold: PDFFont) {
    this.doc = doc;
    this.helv = helv;
    this.helvBold = helvBold;
    this.page = doc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
    this.y = PDF_PAGE_HEIGHT - PDF_MARGIN;
  }

  private addPage(): void {
    this.page = this.doc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
    this.y = PDF_PAGE_HEIGHT - PDF_MARGIN;
  }

  private ensureSpace(needed: number): void {
    if (this.y - needed < PDF_MARGIN) {
      this.addPage();
    }
  }

  render(lines: PdfContentLine[]): void {
    for (const line of lines) {
      if (line.kind === "title") {
        this.drawTitle(line.text);
      } else if (line.kind === "heading") {
        this.drawHeading(line.text);
      } else if (line.text === "") {
        this.blank();
      } else {
        this.drawBody(line.text);
      }
    }
  }

  private drawTitle(text: string): void {
    const spaced = text;
    const wrapped = wrapPdfText(spaced, PDF_CONTENT_WIDTH, PDF_TITLE_SIZE, this.helvBold);
    const lineHeight = PDF_TITLE_SIZE * PDF_LINE_SPACING;
    this.ensureSpace(wrapped.length * lineHeight);
    for (const line of wrapped) {
      const width = this.helvBold.widthOfTextAtSize(line, PDF_TITLE_SIZE);
      this.page.drawText(line, {
        x: PDF_MARGIN + (PDF_CONTENT_WIDTH - width) / 2,
        y: this.y,
        size: PDF_TITLE_SIZE,
        font: this.helvBold,
        color: rgb(0.03, 0.05, 0.2),
      });
      this.y -= lineHeight;
    }
    this.y -= PDF_BODY_SIZE;
  }

  private drawHeading(text: string): void {
    const lineHeight = PDF_HEADING_SIZE * PDF_LINE_SPACING;
    const wrapped = wrapPdfText(text, PDF_CONTENT_WIDTH, PDF_HEADING_SIZE, this.helvBold);
    this.ensureSpace(wrapped.length * lineHeight + PDF_BODY_SIZE);
    for (const line of wrapped) {
      this.page.drawText(line, {
        x: PDF_MARGIN,
        y: this.y,
        size: PDF_HEADING_SIZE,
        font: this.helvBold,
        color: rgb(0.03, 0.05, 0.2),
      });
      this.y -= lineHeight;
    }
    this.y -= PDF_BODY_SIZE;
  }

  private drawBody(text: string): void {
    const lineHeight = PDF_BODY_SIZE * PDF_LINE_SPACING;
    const wrapped = wrapPdfText(text, PDF_CONTENT_WIDTH, PDF_BODY_SIZE, this.helv);
    this.ensureSpace(wrapped.length * lineHeight);
    for (const line of wrapped) {
      this.page.drawText(line, {
        x: PDF_MARGIN,
        y: this.y,
        size: PDF_BODY_SIZE,
        font: this.helv,
        color: rgb(0.08, 0.08, 0.1),
      });
      this.y -= lineHeight;
    }
  }

  private blank(): void {
    this.ensureSpace(PDF_BODY_SIZE * PDF_LINE_SPACING);
    this.y -= PDF_BODY_SIZE * PDF_LINE_SPACING;
  }
}

/**
 * Renders the incident package into a human-readable PDF. Pure document
 * generation: the content is the deterministic package model and nothing else.
 */
export async function renderIncidentPackagePdf(pkg: IncidentPackageMeta): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const writer = new PdfWriter(doc, helv, helvBold);
  writer.render(buildPdfTextContent(pkg));

  doc.setTitle(`FraudFirst Incident Package - ${pkg.incident.incidentId}`);
  doc.setAuthor("FraudFirst");
  doc.setCreator("FraudFirst");
  doc.setProducer("FraudFirst Incident Package Generator");
  await doc.setSubject(`Evidence package for incident ${pkg.incident.incidentId}`);

  const bytes = await doc.save();
  return new Uint8Array(bytes);
}

/** Safe, derived filename for a package download; only ever built from a validated incident id. */
export function packagePdfFilename(incidentId: string): string {
  return `${PACKAGE_PDF_FILENAME_PREFIX}${incidentId}-Incident-Package.pdf`;
}

const SAFE_PACKAGE_FILENAME_RE = /^FraudFirst-FF-\d{8}-[A-Z2-9]{4}-Incident-Package\.pdf$/;

export function isSafePackageFilename(value: string): boolean {
  return SAFE_PACKAGE_FILENAME_RE.test(value);
}