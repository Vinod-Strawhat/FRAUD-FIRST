import { readStorage, writeStorage, STORAGE_KEYS } from "@/services/storage";
import type {
  CreateIncidentInput,
  Incident,
  IncidentStatus,
  IncidentType,
} from "@/types";
import { generateIncidentId } from "./generate-id";

export interface IncidentsService {
  createIncident(input?: CreateIncidentInput): Incident;
  getIncident(id: string): Incident | null;
  updateIncident(
    id: string,
    patch: Partial<Omit<Incident, "id">>
  ): Incident | null;
  getActiveIncidentId(): string | null;
  getActiveIncident(): Incident | null;
  setActiveIncident(id: string | null): void;
  listIncidents(): Incident[];
  upsertIncident(incident: Incident): void;
}

const DEFAULT_STATUS: IncidentStatus = "response_in_progress";
const DEFAULT_TYPE: IncidentType = "unclassified";

class LocalIncidentsService implements IncidentsService {
  private list(): Incident[] {
    return readStorage<Incident[]>(STORAGE_KEYS.incidents) ?? [];
  }

  private save(list: Incident[]): void {
    writeStorage(STORAGE_KEYS.incidents, list);
  }

  createIncident(input: CreateIncidentInput = {}): Incident {
    const now = new Date();
    const nowIso = now.toISOString();
    const existing = this.list();
    const usedIds = new Set(existing.map((incident) => incident.id));
    let id = generateIncidentId(now);
    while (usedIds.has(id)) {
      id = generateIncidentId(now);
    }
    const incident: Incident = {
      id,
      status: DEFAULT_STATUS,
      type: input.type ?? DEFAULT_TYPE,
      amount: input.amount ?? null,
      createdAt: nowIso,
      startedAt: nowIso,
      updatedAt: nowIso,
    };
    this.save([...existing, incident]);
    return incident;
  }

  getIncident(id: string): Incident | null {
    return this.list().find((incident) => incident.id === id) ?? null;
  }

  updateIncident(
    id: string,
    patch: Partial<Omit<Incident, "id">>
  ): Incident | null {
    const list = this.list();
    const index = list.findIndex((incident) => incident.id === id);
    if (index === -1) return null;
    const merged: Incident = {
      ...list[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    list[index] = merged;
    this.save(list);
    return merged;
  }

  getActiveIncidentId(): string | null {
    return readStorage<string>(STORAGE_KEYS.activeIncidentId);
  }

  getActiveIncident(): Incident | null {
    const id = this.getActiveIncidentId();
    return id ? this.getIncident(id) : null;
  }

  setActiveIncident(id: string | null): void {
    writeStorage(STORAGE_KEYS.activeIncidentId, id);
  }

  listIncidents(): Incident[] {
    return this.list();
  }

  upsertIncident(incident: Incident): void {
    const list = this.list();
    const index = list.findIndex((item) => item.id === incident.id);
    if (index === -1) {
      this.save([...list, incident]);
    } else {
      const next = [...list];
      next[index] = incident;
      this.save(next);
    }
  }
}

export const incidentsService: IncidentsService =
  new LocalIncidentsService();