import {
  getIncident,
  isValidIncidentId,
  PersistenceServiceError,
  saveIncident,
} from "@/services/incident-persistence";
import { MAX_PERSISTENCE_BODY_BYTES } from "@/services/incident-sync";
import type {
  GetIncidentResponse,
  PersistenceError,
  PersistenceErrorCode,
  PutIncidentResponse,
} from "@/types";

export const dynamic = "force-dynamic";

function errorBody(code: PersistenceErrorCode, message: string): PersistenceError {
  return { code, message };
}

function errorStatus(code: PersistenceErrorCode): number {
  switch (code) {
    case "INCIDENT_NOT_FOUND":
      return 404;
    case "DYNAMODB_NOT_CONFIGURED":
      return 503;
    case "DYNAMODB_REQUEST_FAILED":
      return 502;
    case "INVALID_INCIDENT":
    case "INVALID_REQUEST":
    default:
      return 400;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapPersistenceFailure(error: unknown): Response {
  if (error instanceof PersistenceServiceError) {
    return Response.json(
      { ok: false, error: error.toError() },
      { status: errorStatus(error.code) }
    );
  }
  return Response.json(
    {
      ok: false,
      error: errorBody(
        "DYNAMODB_REQUEST_FAILED",
        "The incident store could not be reached. Please try again."
      ),
    },
    { status: 502 }
  );
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/incidents/[id]">
): Promise<Response> {
  const { id } = await ctx.params;
  if (!isValidIncidentId(id)) {
    return Response.json(
      {
        ok: false,
        error: errorBody("INVALID_INCIDENT", "The incident id is not valid."),
      } satisfies GetIncidentResponse,
      { status: 400 }
    );
  }

  try {
    const incident = await getIncident(id);
    if (!incident) {
      return Response.json(
        {
          ok: false,
          error: errorBody(
            "INCIDENT_NOT_FOUND",
            "No incident exists with this id."
          ),
        } satisfies GetIncidentResponse,
        { status: 404 }
      );
    }
    return Response.json({ ok: true, incident } satisfies GetIncidentResponse, {
      status: 200,
    });
  } catch (error) {
    return mapPersistenceFailure(error);
  }
}

export async function PUT(
  request: Request,
  ctx: RouteContext<"/api/incidents/[id]">
): Promise<Response> {
  const { id } = await ctx.params;
  if (!isValidIncidentId(id)) {
    return Response.json(
      {
        ok: false,
        error: errorBody("INVALID_INCIDENT", "The incident id is not valid."),
      } satisfies PutIncidentResponse,
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        ok: false,
        error: errorBody("INVALID_REQUEST", "The request could not be read."),
      } satisfies PutIncidentResponse,
      { status: 400 }
    );
  }

  if (!isRecord(body)) {
    return Response.json(
      {
        ok: false,
        error: errorBody("INVALID_REQUEST", "The incident payload is invalid."),
      } satisfies PutIncidentResponse,
      { status: 400 }
    );
  }

  const serialized = JSON.stringify(body);
  if (serialized.length > MAX_PERSISTENCE_BODY_BYTES) {
    return Response.json(
      {
        ok: false,
        error: errorBody(
          "INVALID_REQUEST",
          "The incident payload exceeds the supported size limit."
        ),
      } satisfies PutIncidentResponse,
      { status: 413 }
    );
  }

  try {
    const { record } = await saveIncident(body, id);
    return Response.json(
      {
        ok: true,
        incidentId: record.incidentId,
        updatedAt: record.updatedAt,
      } satisfies PutIncidentResponse,
      { status: 200 }
    );
  } catch (error) {
    return mapPersistenceFailure(error);
  }
}