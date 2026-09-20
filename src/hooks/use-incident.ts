"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  attachSessionFile,
  evidenceService,
  getSessionFile,
  incidentsService,
  timelineService,
} from "@/services";
import { fetchRemoteIncident, pushIncidentRecord } from "@/services/incident-sync";
import {
  buildIncidentWorkspaceRecord,
  incidentFromRecord,
  workspaceRecordSignature,
} from "@/lib/incident-record";
import type {
  EvidenceRecord,
  Incident,
  IncidentTimelineEvent,
  IncidentWorkspaceRecord,
  PersistenceStatus,
} from "@/types";

interface IncidentSnapshot {
  incident: Incident | null;
  evidence: EvidenceRecord[];
  timeline: IncidentTimelineEvent[];
}

const EMPTY_SNAPSHOT: IncidentSnapshot = {
  incident: null,
  evidence: [],
  timeline: [],
};

type PushDrain = () => Promise<void>;
type QueuePush = (record: IncidentWorkspaceRecord) => void;

function hydrateLocalFromRemote(record: IncidentWorkspaceRecord): void {
  incidentsService.upsertIncident(incidentFromRecord(record));
  incidentsService.setActiveIncident(record.incidentId);
  evidenceService.replaceForIncident(record.incidentId, record.evidence);
  timelineService.replaceForIncident(record.incidentId, record.timeline);
}

function currentLocalSnapshot(incidentId: string): IncidentSnapshot {
  return {
    incident: incidentsService.getIncident(incidentId),
    evidence: evidenceService.listEvidenceByIncident(incidentId),
    timeline: timelineService.listByIncident(incidentId),
  };
}

export function useIncident(incidentId: string | undefined) {
  const [snapshot, setSnapshot] = useState<IncidentSnapshot>(EMPTY_SNAPSHOT);
  const [isReady, setIsReady] = useState(false);
  const [restoreDone, setRestoreDone] = useState(false);
  const [persistence, setPersistence] = useState<PersistenceStatus>("local");

  const lastPushedRef = useRef<string | null>(null);
  const queuedPushRef = useRef<IncidentWorkspaceRecord | null>(null);
  const inFlightPushRef = useRef(false);
  const restoreInProgressRef = useRef(false);

  const pushDrainRef = useRef<PushDrain>(async () => {});
  const queuePushRef = useRef<QueuePush>(() => {});

  useEffect(() => {
    pushDrainRef.current = async () => {
      if (inFlightPushRef.current) return;
      inFlightPushRef.current = true;
      try {
        while (queuedPushRef.current) {
          const record = queuedPushRef.current;
          queuedPushRef.current = null;
          const signature = workspaceRecordSignature(record);
          if (signature === lastPushedRef.current) continue;
          setPersistence("syncing");
          const result = await pushIncidentRecord(record);
          if (restoreInProgressRef.current) return;
          if (result.ok) {
            lastPushedRef.current = signature;
            setPersistence("synced");
          } else if (result.error.code === "DYNAMODB_NOT_CONFIGURED") {
            setPersistence("local");
          } else {
            setPersistence("unavailable");
          }
        }
      } finally {
        inFlightPushRef.current = false;
        if (queuedPushRef.current) {
          void pushDrainRef.current();
        }
      }
    };

    queuePushRef.current = (record: IncidentWorkspaceRecord) => {
      queuedPushRef.current = record;
      void pushDrainRef.current();
    };
  }, []);

  const reload = useCallback(() => {
    if (!incidentId) {
      setSnapshot(EMPTY_SNAPSHOT);
      setIsReady(true);
      return;
    }
    const local = currentLocalSnapshot(incidentId);
    if (local.incident) {
      incidentsService.setActiveIncident(local.incident.id);
    }
    setSnapshot(local);
    setIsReady(true);
  }, [incidentId]);

  useEffect(() => {
    const timer = window.setTimeout(reload, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  useEffect(() => {
    if (!incidentId) {
      const timer = window.setTimeout(() => setRestoreDone(true), 0);
      return () => window.clearTimeout(timer);
    }

    let cancelled = false;
    restoreInProgressRef.current = true;

    const syncStatusTimer = window.setTimeout(() => {
      setRestoreDone(false);
      setPersistence("syncing");
    }, 0);

    (async () => {
      const result = await fetchRemoteIncident(incidentId);
      if (cancelled) return;

      if (result.ok) {
        const remote = result.incident;
        const local = currentLocalSnapshot(incidentId);
        const localRecord = buildIncidentWorkspaceRecord(local);
        const remoteNewer =
          !localRecord || remote.updatedAt > localRecord.updatedAt;

        if (remoteNewer) {
          hydrateLocalFromRemote(remote);
          lastPushedRef.current = workspaceRecordSignature(remote);
          setPersistence("synced");
        } else {
          lastPushedRef.current = null;
        }
      } else if (result.error.code === "DYNAMODB_NOT_CONFIGURED") {
        setPersistence("local");
      } else if (result.error.code === "INCIDENT_NOT_FOUND") {
        setPersistence("local");
      } else {
        setPersistence("unavailable");
      }

      restoreInProgressRef.current = false;
      if (!cancelled) {
        queuedPushRef.current = null;
        inFlightPushRef.current = false;
        reload();
        window.setTimeout(() => setRestoreDone(true), 0);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(syncStatusTimer);
    };
  }, [incidentId, reload]);

  useEffect(() => {
    if (!incidentId || restoreInProgressRef.current) return;
    const record = buildIncidentWorkspaceRecord(snapshot);
    if (!record) return;
    const signature = workspaceRecordSignature(record);
    if (signature === lastPushedRef.current) return;
    queuePushRef.current(record);
  }, [snapshot, incidentId]);

  const addFiles = useCallback(
    (files: File[]) => {
      if (!incidentId || files.length === 0) return;
      const nowIso = new Date().toISOString();
      for (const file of files) {
        const record = evidenceService.addEvidence({
          incidentId,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
        });
        attachSessionFile(record.id, file);
      }
      incidentsService.updateIncident(incidentId, { updatedAt: nowIso });
      reload();
    },
    [incidentId, reload]
  );

  const removeEvidence = useCallback(
    (evidenceId: string) => {
      if (!incidentId) return;
      evidenceService.removeEvidence(incidentId, evidenceId);
      incidentsService.updateIncident(incidentId, {
        updatedAt: new Date().toISOString(),
      });
      reload();
    },
    [incidentId, reload]
  );

  return {
    incident: snapshot.incident,
    evidence: snapshot.evidence,
    timeline: snapshot.timeline,
    isReady,
    restoreDone,
    persistence,
    addFiles,
    removeEvidence,
    hasFile: getSessionFile,
    reload,
  };
}