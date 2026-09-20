import type {
  AddEvidenceInput,
  CorrelationError,
  EvidenceExtractionMeta,
  EvidencePreservationMeta,
  EvidenceRecord,
  EvidenceStorageMeta,
  EvidenceStorageStatus,
  CorrelatedCorrelationMeta,
  TimelineEventType,
  TimelineTone,
} from "@/types";
import { readStorage, writeStorage, STORAGE_KEYS } from "@/services/storage";
import { makeEntityId } from "@/services/incidents/generate-id";
import { timelineService } from "@/services/timeline";

export interface EvidenceService {
  addEvidence(input: AddEvidenceInput): EvidenceRecord;
  getEvidence(id: string): EvidenceRecord | null;
  listEvidenceByIncident(incidentId: string): EvidenceRecord[];
  removeEvidence(incidentId: string, evidenceId: string): boolean;
  replaceForIncident(
    incidentId: string,
    records: EvidenceRecord[]
  ): void;
  markProcessing(evidenceId: string): boolean;
  markProcessed(
    evidenceId: string,
    meta: EvidenceExtractionMeta
  ): boolean;
  markFailed(evidenceId: string): boolean;
  markCaptured(evidenceId: string): boolean;
  markPreserving(evidenceId: string): boolean;
  markPreserved(
    evidenceId: string,
    meta: EvidencePreservationMeta
  ): boolean;
  markPreservationFailed(evidenceId: string): boolean;
  markPreservationReverted(evidenceId: string): boolean;
  markCorrelating(evidenceId: string): boolean;
  markCorrelated(
    evidenceId: string,
    meta: CorrelatedCorrelationMeta
  ): boolean;
  markCorrelationFailed(
    evidenceId: string,
    error: CorrelationError
  ): boolean;
  markCorrelationReverted(evidenceId: string): boolean;
}

const sessionFiles = new Map<string, File>();

export function attachSessionFile(evidenceId: string, file: File): void {
  sessionFiles.set(evidenceId, file);
}

export function getSessionFile(evidenceId: string): File | null {
  return sessionFiles.get(evidenceId) ?? null;
}

export function detachSessionFile(evidenceId: string): void {
  sessionFiles.delete(evidenceId);
}

class LocalEvidenceService implements EvidenceService {
  private list(): EvidenceRecord[] {
    return readStorage<EvidenceRecord[]>(STORAGE_KEYS.evidence) ?? [];
  }

  private save(list: EvidenceRecord[]): void {
    writeStorage(STORAGE_KEYS.evidence, list);
  }

  addEvidence(input: AddEvidenceInput): EvidenceRecord {
    const record: EvidenceRecord = {
      id: makeEntityId("ev"),
      incidentId: input.incidentId,
      filename: input.filename,
      mimeType: input.mimeType,
      size: input.size,
      category: "unclassified",
      status: "captured",
      capturedAt: new Date().toISOString(),
    };
    this.save([...this.list(), record]);
    timelineService.addEvent({
      incidentId: record.incidentId,
      type: "evidence_captured",
      tone: "info",
      label: "Evidence captured",
      detail: record.filename,
    });
    return record;
  }

  getEvidence(id: string): EvidenceRecord | null {
    return this.list().find((record) => record.id === id) ?? null;
  }

  listEvidenceByIncident(incidentId: string): EvidenceRecord[] {
    return this.list().filter((record) => record.incidentId === incidentId);
  }

  removeEvidence(incidentId: string, evidenceId: string): boolean {
    const list = this.list();
    const record = list.find(
      (item) => item.incidentId === incidentId && item.id === evidenceId
    );
    if (!record) return false;
    const next = list.filter(
      (item) => !(item.incidentId === incidentId && item.id === evidenceId)
    );
    this.save(next);
    detachSessionFile(evidenceId);
    timelineService.addEvent({
      incidentId,
      type: "evidence_removed",
      tone: "info",
      label: "Evidence removed",
      detail: record.filename,
    });
    return true;
  }

  replaceForIncident(
    incidentId: string,
    records: EvidenceRecord[],
  ): void {
    const list = this.list();
    const next = list.filter((item) => item.incidentId !== incidentId);
    this.save([...next, ...records]);
  }

  markProcessing(evidenceId: string): boolean {
    return this.update(evidenceId, {
      targetStatus: "processing",
      fromStatuses: ["captured", "processed", "failed"],
      meta: { clear: true },
      timeline: {
        type: "evidence_processing_started",
        label: "Evidence processing started",
      },
    });
  }

  markProcessed(
    evidenceId: string,
    meta: EvidenceExtractionMeta
  ): boolean {
    return this.update(evidenceId, {
      targetStatus: "processed",
      fromStatuses: ["processing"],
      meta: { set: meta },
      timeline: {
        type: "text_extracted",
        label: "Text extracted",
      },
    });
  }

  markFailed(evidenceId: string): boolean {
    return this.update(evidenceId, {
      targetStatus: "failed",
      fromStatuses: ["processing"],
      meta: { clear: true },
      timeline: {
        type: "evidence_processing_failed",
        label: "Evidence processing failed",
        tone: "warn",
      },
    });
  }

  markCaptured(evidenceId: string): boolean {
    return this.update(evidenceId, {
      targetStatus: "captured",
      fromStatuses: ["processing"],
      meta: { clear: true },
    });
  }

  markPreserving(evidenceId: string): boolean {
    return this.updateStorage(evidenceId, {
      fromStorage: ["not_preserved", "preservation_failed"],
      toStorage: { status: "preserving" },
      timeline: {
        type: "evidence_preservation_started",
        label: "Evidence preservation started",
      },
    });
  }

  markPreserved(
    evidenceId: string,
    meta: EvidencePreservationMeta
  ): boolean {
    return this.updateStorage(evidenceId, {
      fromStorage: ["preserving"],
      toStorage: meta,
      timeline: {
        type: "evidence_preserved",
        label: "Original evidence preserved",
      },
    });
  }

  markPreservationFailed(evidenceId: string): boolean {
    return this.updateStorage(evidenceId, {
      fromStorage: ["preserving"],
      toStorage: { status: "preservation_failed" },
      timeline: {
        type: "evidence_preservation_failed",
        label: "Evidence preservation failed",
        tone: "warn",
      },
    });
  }

  markPreservationReverted(evidenceId: string): boolean {
    return this.updateStorage(evidenceId, {
      fromStorage: ["preserving"],
      toStorage: { status: "not_preserved" },
    });
  }

  markCorrelating(evidenceId: string): boolean {
    const list = this.list();
    const record = list.find((item) => item.id === evidenceId);
    if (!record) return false;
    const current: EvidenceRecord["correlation"] = record.correlation;
    const currentStatus = current?.status ?? "not_correlated";
    if (
      currentStatus !== "not_correlated" &&
      currentStatus !== "correlation_failed" &&
      currentStatus !== "correlated"
    ) {
      return false;
    }
    const next = list.map((item) => {
      if (item.id !== evidenceId) return item;
      return {
        ...item,
        correlation: { status: "correlating" as const },
      };
    });
    this.save(next);
    return true;
  }

  markCorrelated(
    evidenceId: string,
    meta: CorrelatedCorrelationMeta
  ): boolean {
    const list = this.list();
    const record = list.find((item) => item.id === evidenceId);
    if (!record) return false;
    if (record.correlation?.status !== "correlating") return false;
    const next = list.map((item) => {
      if (item.id !== evidenceId) return item;
      return { ...item, correlation: { ...meta } };
    });
    this.save(next);
    this.correlateTimelineEvent(record);
    return true;
  }

  markCorrelationFailed(
    evidenceId: string,
    error: CorrelationError
  ): boolean {
    const list = this.list();
    const record = list.find((item) => item.id === evidenceId);
    if (!record) return false;
    if (record.correlation?.status !== "correlating") return false;
    const next = list.map((item) => {
      if (item.id !== evidenceId) return item;
      return {
        ...item,
        correlation: {
          status: "correlation_failed" as const,
          error,
        },
      };
    });
    this.save(next);
    timelineService.addEvent({
      incidentId: record.incidentId,
      type: "evidence_correlation_failed",
      tone: "warn",
      label: "Evidence correlation failed",
      detail: record.filename,
    });
    return true;
  }

  markCorrelationReverted(evidenceId: string): boolean {
    const list = this.list();
    const record = list.find((item) => item.id === evidenceId);
    if (!record) return false;
    if (record.correlation?.status !== "correlating") return false;
    const next = list.map((item) => {
      if (item.id !== evidenceId) return item;
      return { ...item, correlation: { status: "not_correlated" as const } };
    });
    this.save(next);
    return true;
  }

  private correlateTimelineEvent(record: EvidenceRecord): void {
    const events = timelineService.listByIncident(record.incidentId);
    const alreadyLogged = events.some(
      (event) =>
        event.type === "evidence_correlated" && event.detail === record.filename
    );
    if (alreadyLogged) return;
    timelineService.addEvent({
      incidentId: record.incidentId,
      type: "evidence_correlated",
      tone: "info",
      label: "Evidence correlated",
      detail: record.filename,
    });
  }

  private updateStorage(
    evidenceId: string,
    options: {
      fromStorage: EvidenceStorageStatus[];
      toStorage: EvidenceStorageMeta;
      timeline?: {
        type: TimelineEventType;
        label: string;
        tone?: TimelineTone;
      };
    }
  ): boolean {
    const list = this.list();
    const record = list.find((item) => item.id === evidenceId);
    if (!record) return false;
    const currentStatus: EvidenceStorageStatus =
      record.storage?.status ?? "not_preserved";
    if (!options.fromStorage.includes(currentStatus)) return false;
    const next = list.map((item) => {
      if (item.id !== evidenceId) return item;
      return { ...item, storage: options.toStorage };
    });
    this.save(next);
    if (options.timeline) {
      timelineService.addEvent({
        incidentId: record.incidentId,
        type: options.timeline.type,
        tone: options.timeline.tone ?? "info",
        label: options.timeline.label,
        detail: record.filename,
      });
    }
    return true;
  }

  private update(
    evidenceId: string,
    options: {
      targetStatus: EvidenceRecord["status"];
      fromStatuses: EvidenceRecord["status"][];
      meta: { set?: EvidenceExtractionMeta; clear?: boolean };
      timeline?: {
        type: TimelineEventType;
        label: string;
        tone?: TimelineTone;
      };
    }
  ): boolean {
    const list = this.list();
    const record = list.find((item) => item.id === evidenceId);
    if (!record) return false;
    if (!options.fromStatuses.includes(record.status)) return false;
    const next = list.map((item) => {
      if (item.id !== evidenceId) return item;
      const updated: EvidenceRecord = {
        ...item,
        status: options.targetStatus,
      };
      if (options.meta.set) {
        updated.extraction = options.meta.set;
      } else if (options.meta.clear) {
        delete updated.extraction;
      }
      return updated;
    });
    this.save(next);
    if (options.timeline) {
      timelineService.addEvent({
        incidentId: record.incidentId,
        type: options.timeline.type,
        tone: options.timeline.tone ?? "info",
        label: options.timeline.label,
        detail: record.filename,
      });
    }
    return true;
  }
}

export const evidenceService: EvidenceService = new LocalEvidenceService();