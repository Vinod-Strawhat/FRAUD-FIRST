import {
  getIncidentIntelligence,
} from "@/services/intelligence/brief";
import {
  isValidIncidentId,
  PersistenceServiceError,
} from "@/services/incident-persistence";
import type {
  GetIncidentIntelligenceResponse,
  PersistenceError,
  PersistenceErrorCode,
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

function mapIntelligenceFailure(error: unknown): Response {
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
  ctx: RouteContext<"/api/incidents/[id]/intelligence">
): Promise<Response> {
  const { id } = await ctx.params;
  if (!isValidIncidentId(id)) {
    return Response.json(
      {
        ok: false,
        error: errorBody("INVALID_INCIDENT", "The incident id is not valid."),
      } satisfies GetIncidentIntelligenceResponse,
      { status: 400 }
    );
  }

  try {
    const intelligence = await getIncidentIntelligence(id);
    return Response.json(
      { ok: true, intelligence } satisfies GetIncidentIntelligenceResponse,
      { status: 200 }
    );
  } catch (error) {
    return mapIntelligenceFailure(error);
  }
}