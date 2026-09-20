import type {
  GetIncidentResponse,
  IncidentWorkspaceRecord,
  PersistenceError,
  PutIncidentResponse,
} from "@/types";

export const MAX_PERSISTENCE_BODY_BYTES = 512 * 1024;

function readError(data: unknown): PersistenceError {
  if (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof (data as { error?: unknown }).error === "object" &&
    (data as { error?: unknown }).error !== null
  ) {
    const error = (data as { error: Partial<PersistenceError> }).error;
    return {
      code: error.code ?? "DYNAMODB_REQUEST_FAILED",
      message: error.message ?? "Incident sync failed.",
    };
  }
  return {
    code: "DYNAMODB_REQUEST_FAILED",
    message: "Incident sync failed.",
  };
}

export async function fetchRemoteIncident(
  incidentId: string
): Promise<GetIncidentResponse> {
  let response: Response;
  try {
    response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch {
    return {
      ok: false,
      error: {
        code: "DYNAMODB_REQUEST_FAILED",
        message: "Could not reach the incident store.",
      },
    };
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    return {
      ok: false,
      error: {
        code: "DYNAMODB_REQUEST_FAILED",
        message: "The incident store returned an unreadable response.",
      },
    };
  }

  if (response.ok && typeof data === "object" && data !== null && "incident" in data) {
    return { ok: true, incident: (data as { incident: IncidentWorkspaceRecord }).incident };
  }
  return { ok: false, error: readError(data) };
}

export async function pushIncidentRecord(
  record: IncidentWorkspaceRecord
): Promise<PutIncidentResponse> {
  const json = JSON.stringify(record);
  if (json.length > MAX_PERSISTENCE_BODY_BYTES) {
    return {
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "The incident is too large to sync.",
      },
    };
  }

  let response: Response;
  try {
    response = await fetch(
      `/api/incidents/${encodeURIComponent(record.incidentId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: json,
      }
    );
  } catch {
    return {
      ok: false,
      error: {
        code: "DYNAMODB_REQUEST_FAILED",
        message: "Could not reach the incident store.",
      },
    };
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    return {
      ok: false,
      error: {
        code: "DYNAMODB_REQUEST_FAILED",
        message: "The incident store returned an unreadable response.",
      },
    };
  }

  if (response.ok) {
    return {
      ok: true,
      incidentId: record.incidentId,
      updatedAt: record.updatedAt,
    };
  }
  return { ok: false, error: readError(data) };
}

export function persistenceBodySize(record: IncidentWorkspaceRecord): number {
  return JSON.stringify(record).length;
}