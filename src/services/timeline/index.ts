import {
  readStorage,
  writeStorage,
  STORAGE_KEYS,
} from "@/services/storage";
import { makeEntityId } from "@/services/incidents/generate-id";
import type {
  AddTimelineEventInput,
  IncidentTimelineEvent,
} from "@/types";

export interface TimelineService {
  addEvent(input: AddTimelineEventInput): IncidentTimelineEvent;
  getEvent(id: string): IncidentTimelineEvent | null;
  listByIncident(incidentId: string): IncidentTimelineEvent[];
  replaceForIncident(
    incidentId: string,
    events: IncidentTimelineEvent[]
  ): void;
}

class LocalTimelineService implements TimelineService {
  private list(): IncidentTimelineEvent[] {
    return readStorage<IncidentTimelineEvent[]>(STORAGE_KEYS.timeline) ?? [];
  }

  private save(list: IncidentTimelineEvent[]): void {
    writeStorage(STORAGE_KEYS.timeline, list);
  }

  addEvent(input: AddTimelineEventInput): IncidentTimelineEvent {
    const event: IncidentTimelineEvent = {
      id: makeEntityId("tl"),
      incidentId: input.incidentId,
      type: input.type,
      tone: input.tone,
      label: input.label,
      detail: input.detail,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
    };
    this.save([...this.list(), event]);
    return event;
  }

  getEvent(id: string): IncidentTimelineEvent | null {
    return this.list().find((event) => event.id === id) ?? null;
  }

  listByIncident(incidentId: string): IncidentTimelineEvent[] {
    return this.list()
      .filter((event) => event.incidentId === incidentId)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }

  replaceForIncident(
    incidentId: string,
    events: IncidentTimelineEvent[]
  ): void {
    const list = this.list();
    const next = list.filter((event) => event.incidentId !== incidentId);
    this.save(
      [...next, ...events].sort((a, b) =>
        a.occurredAt.localeCompare(b.occurredAt)
      )
    );
  }
}

export const timelineService: TimelineService = new LocalTimelineService();