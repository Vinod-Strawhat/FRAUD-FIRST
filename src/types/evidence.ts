import type { EvidenceExtractionMeta } from "@/types/extraction";
import type { EvidenceCorrelationMeta } from "@/types/correlation";

export type EvidenceCategory =
  | "bank_sms"
  | "upi_screenshot"
  | "whatsapp_chat"
  | "phone_number"
  | "qr_code"
  | "email"
  | "transaction_receipt"
  | "other"
  | "unclassified";

export type EvidenceStatus = "captured" | "processing" | "processed" | "failed";

export type EvidenceStorageStatus =
  | "not_preserved"
  | "preserving"
  | "preserved"
  | "preservation_failed";

export interface EvidenceStorageMeta {
  status: EvidenceStorageStatus;
  preservedAt?: string;
  sha256?: string;
  s3Key?: string;
  bucket?: string;
  contentType?: string;
  byteSize?: number;
}

export interface EvidenceRecord {
  id: string;
  incidentId: string;
  filename: string;
  mimeType: string;
  size: number;
  category: EvidenceCategory;
  status: EvidenceStatus;
  capturedAt: string;
  extraction?: EvidenceExtractionMeta;
  storage?: EvidenceStorageMeta;
  correlation?: EvidenceCorrelationMeta;
}

export interface AddEvidenceInput {
  incidentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export const EVIDENCE_CATEGORY_LABELS: Record<EvidenceCategory, string> = {
  bank_sms: "Bank SMS",
  upi_screenshot: "UPI screenshot",
  whatsapp_chat: "WhatsApp/chat",
  phone_number: "Phone number",
  qr_code: "QR code",
  email: "Email",
  transaction_receipt: "Transaction receipt",
  other: "Other",
  unclassified: "Unclassified",
};