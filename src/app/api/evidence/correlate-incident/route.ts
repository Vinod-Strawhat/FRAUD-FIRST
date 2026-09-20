import {
  correlateIncidentEvidence,
} from "@/services/correlation/orchestrate";
import { PersistenceServiceError } from "@/services/incident-persistence";
import { DynamoDbConflictError } from "@/services/server/dynamodb";
import type {
  CorrelateIncidentErrorResponse,
  CorrelateIncidentRequest,
  CorrelateIncidentSuccessResponse,
  CorrelationError,
  CorrelationErrorCode,
  CorrelationTextClaim,
} from "@/types";

export const dynamic = "force-dynamic";

const INCIDENT_ID_RE = /^FF-\d{8}-[A-Z2-9]{4}$/;
const EVIDENCE_ID_RE = /^ev_[A-Za-z0-9_-]+$/;

const MAX_CLAIMS = 500;
const MAX_CLAIM_TEXT_CHARS = 60_000;

function errorBody(code: CorrelationErrorCode, message: string): CorrelationError {
  return { code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function mapPersistenceFailure(error: unknown): CorrelationError {
  if (error instanceof PersistenceServiceError) {
    switch (error.code) {
      case "INCIDENT_NOT_FOUND":
        return errorBody("INCIDENT_NOT_FOUND", error.message);
      case "INVALID_INCIDENT":
      case "INVALID_REQUEST":
        return errorBody("INVALID_REQUEST", error.message);
      case "EVIDENCE_NOT_FOUND":
        return errorBody("EVIDENCE_NOT_FOUND", error.message);
      case "EXTRACTION_NOT_AVAILABLE":
        return errorBody("EXTRACTION_NOT_AVAILABLE", error.message);
      case "DYNAMODB_NOT_CONFIGURED":
        return errorBody(
          "BEDROCK_NOT_CONFIGURED",
          "Incident persistence is not configured for this environment."
        );
      default:
        return errorBody("BEDROCK_REQUEST_FAILED", error.message);
    }
  }
  if (error instanceof DynamoDbConflictError) {
    return errorBody(
      "BEDROCK_REQUEST_FAILED",
      "The incident changed while it was being correlated. Try again."
    );
  }
  return errorBody("BEDROCK_REQUEST_FAILED", "AI correlation failed. Try again.");
}

export async function POST(request: Request): Promise<Response> {
  let body: CorrelateIncidentRequest;
  try {
    const parsed = (await request.json()) as unknown;
    if (!isRecord(parsed)) {
      return Response.json(
        {
          ok: false,
          error: errorBody("INVALID_REQUEST", "The request body is invalid."),
        } satisfies CorrelateIncidentErrorResponse,
        { status: 400 }
      );
    }
    body = parsed as CorrelateIncidentRequest;
  } catch {
    return Response.json(
      {
        ok: false,
        error: errorBody("INVALID_REQUEST", "The request could not be read."),
      } satisfies CorrelateIncidentErrorResponse,
      { status: 400 }
    );
  }

  if (
    !isString(body.incidentId) ||
    !INCIDENT_ID_RE.test(body.incidentId)
  ) {
    return Response.json(
      {
        ok: false,
        error: errorBody(
          "INCIDENT_NOT_FOUND",
          "The incident id is not valid."
        ),
      } satisfies CorrelateIncidentErrorResponse,
      { status: 400 }
    );
  }

  if (body.claims === undefined || body.claims === null) {
    body.claims = [];
  }
  if (!Array.isArray(body.claims)) {
    return Response.json(
      {
        ok: false,
        error: errorBody("INVALID_REQUEST", "claims must be an array."),
      } satisfies CorrelateIncidentErrorResponse,
      { status: 400 }
    );
  }
  if (body.claims.length > MAX_CLAIMS) {
    return Response.json(
      {
        ok: false,
        error: errorBody(
          "INVALID_REQUEST",
          "Too many evidence text claims."
        ),
      } satisfies CorrelateIncidentErrorResponse,
      { status: 413 }
    );
  }

  const claims: CorrelationTextClaim[] = [];
  for (const entry of body.claims) {
    if (!isRecord(entry)) {
      return Response.json(
        {
          ok: false,
          error: errorBody("INVALID_REQUEST", "A text claim is invalid."),
        } satisfies CorrelateIncidentErrorResponse,
        { status: 400 }
      );
    }
    if (
      !isString(entry.evidenceId) ||
      !EVIDENCE_ID_RE.test(entry.evidenceId)
    ) {
      return Response.json(
        {
          ok: false,
          error: errorBody(
            "EVIDENCE_NOT_FOUND",
            "An evidence id in the claims is not valid."
          ),
        } satisfies CorrelateIncidentErrorResponse,
        { status: 400 }
      );
    }
    if (!isString(entry.text)) {
      return Response.json(
        {
          ok: false,
          error: errorBody(
            "EXTRACTION_NOT_AVAILABLE",
            "A text claim is missing extracted text."
          ),
        } satisfies CorrelateIncidentErrorResponse,
        { status: 400 }
      );
    }
    if (entry.text.length > MAX_CLAIM_TEXT_CHARS) {
      return Response.json(
        {
          ok: false,
          error: errorBody(
            "INVALID_REQUEST",
            "A text claim exceeds the supported correlation size limit."
          ),
        } satisfies CorrelateIncidentErrorResponse,
        { status: 413 }
      );
    }
    claims.push({
      evidenceId: entry.evidenceId,
      text: entry.text,
      source: isString(entry.source) ? entry.source : undefined,
      confidence: typeof entry.confidence === "number" ? entry.confidence : undefined,
      extractedAt: isString(entry.extractedAt) ? entry.extractedAt : undefined,
    });
  }

  const serializedClaims = JSON.stringify(claims);
  if (serializedClaims.length > 512 * 1024) {
    return Response.json(
      {
        ok: false,
        error: errorBody(
          "INVALID_REQUEST",
          "The text claims exceed the supported size limit."
        ),
      } satisfies CorrelateIncidentErrorResponse,
      { status: 413 }
    );
  }

  try {
    const correlation = await correlateIncidentEvidence(
      body.incidentId,
      claims
    );
    return Response.json(
      {
        ok: true,
        incidentId: body.incidentId,
        correlation,
      } satisfies CorrelateIncidentSuccessResponse,
      { status: 200 }
    );
  } catch (error) {
    const mapped = mapPersistenceFailure(error);
    const status =
      mapped.code === "BEDROCK_NOT_CONFIGURED"
        ? 503
        : mapped.code === "INCIDENT_NOT_FOUND"
          ? 404
          : mapped.code === "INVALID_REQUEST" ||
              mapped.code === "EVIDENCE_NOT_FOUND" ||
              mapped.code === "EXTRACTION_NOT_AVAILABLE"
            ? 400
            : 502;
    return Response.json(
      { ok: false, error: mapped } satisfies CorrelateIncidentErrorResponse,
      { status }
    );
  }
}