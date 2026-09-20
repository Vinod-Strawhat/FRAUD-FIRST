import { isValidIncidentId } from "@/services/incident-persistence";
import {
  ResponseServiceError,
  startIncidentResponse,
} from "@/services/response/server";
import type {
  ResponseError,
  ResponseErrorCode,
  StartResponseResult,
} from "@/types";

export const dynamic = "force-dynamic";

function errorBody(code: ResponseErrorCode, message: string): ResponseError {
  return { code, message };
}

function errorStatus(code: ResponseErrorCode): number {
  switch (code) {
    case "INCIDENT_NOT_FOUND":
    case "RESPONSE_NOT_FOUND":
    case "ACTION_NOT_FOUND":
      return 404;
    case "RESPONSE_ALREADY_STARTED":
    case "ACTION_NOT_CURRENT":
    case "ACTION_ALREADY_COMPLETED":
      return 409;
    case "STEP_FUNCTIONS_NOT_CONFIGURED":
    case "DYNAMODB_NOT_CONFIGURED":
      return 503;
    case "STEP_FUNCTIONS_REQUEST_FAILED":
    case "DYNAMODB_REQUEST_FAILED":
      return 502;
    case "INVALID_REQUEST":
    case "INVALID_INCIDENT":
    default:
      return 400;
  }
}

function mapResponseFailure(error: unknown): Response {
  if (error instanceof ResponseServiceError) {
    return Response.json(
      { ok: false, error: error.toError() },
      { status: errorStatus(error.code) }
    );
  }
  return Response.json(
    {
      ok: false,
      error: errorBody(
        "STEP_FUNCTIONS_REQUEST_FAILED",
        "The response workflow could not be reached. Please try again."
      ),
    },
    { status: 502 }
  );
}

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/incidents/[id]/response/start">
): Promise<Response> {
  const { id } = await ctx.params;
  if (!isValidIncidentId(id)) {
    return Response.json(
      {
        ok: false,
        error: errorBody("INVALID_INCIDENT", "The incident id is not valid."),
      } satisfies StartResponseResult,
      { status: 400 }
    );
  }

  try {
    const response = await startIncidentResponse(id);
    return Response.json({ ok: true, response } satisfies StartResponseResult, {
      status: 200,
    });
  } catch (error) {
    return mapResponseFailure(error);
  }
}