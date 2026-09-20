import {
  buildIncidentPackage,
  PackageServiceError,
} from "@/services/package/builder";
import { isValidIncidentId } from "@/services/incident-persistence";
import type {
  GetIncidentPackageResponse,
  PackageError,
  PackageErrorCode,
} from "@/types";

export const dynamic = "force-dynamic";

function errorBody(code: PackageErrorCode, message: string): PackageError {
  return { code, message };
}

function errorStatus(code: PackageErrorCode): number {
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

function mapPackageFailure(error: unknown): Response {
  if (error instanceof PackageServiceError) {
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
  ctx: RouteContext<"/api/incidents/[id]/package">
): Promise<Response> {
  const { id } = await ctx.params;
  if (!isValidIncidentId(id)) {
    return Response.json(
      {
        ok: false,
        error: errorBody("INVALID_INCIDENT", "The incident id is not valid."),
      } satisfies GetIncidentPackageResponse,
      { status: 400 }
    );
  }

  try {
    const result = await buildIncidentPackage(id);
    return Response.json(
      { ok: true, result } satisfies GetIncidentPackageResponse,
      { status: 200 }
    );
  } catch (error) {
    return mapPackageFailure(error);
  }
}