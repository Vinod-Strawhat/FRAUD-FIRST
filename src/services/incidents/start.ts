import { incidentsService } from "./index";
import { timelineService } from "@/services/timeline";
import type { Incident } from "@/types";

export function startNewIncident(): Incident {
  const incident = incidentsService.createIncident();
  incidentsService.setActiveIncident(incident.id);
  const nowIso = new Date().toISOString();
  timelineService.addEvent({
    incidentId: incident.id,
    type: "incident_started",
    tone: "critical",
    label: "Incident started",
    occurredAt: nowIso,
  });
  timelineService.addEvent({
    incidentId: incident.id,
    type: "evidence_intake_ready",
    tone: "info",
    label: "Evidence intake ready",
    occurredAt: nowIso,
  });
  return incident;
}