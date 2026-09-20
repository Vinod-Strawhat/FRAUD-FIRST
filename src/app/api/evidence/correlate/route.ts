import {
  CORRELATION_HARD_LIMIT_CHARS,
  correlateEvidenceText,
  CorrelationServiceError,
} from "@/services/correlation";
import { BedrockRuntimeError } from "@/services/server/bedrock";
import { OpenRouterRuntimeError } from "@/services/server/openrouter";
import type {
  CorrelationError,
  CorrelationErrorCode,
  CorrelateEvidenceRequest,
  CorrelateEvidenceResponse,
} from "@/types";

export const dynamic = "force-dynamic";

const INCIDENT_ID_RE = /^FF-\d{8}-[A-Z2-9]{4}$/;
const EVIDENCE_ID_RE = /^ev_[A-Za-z0-9_-]+$/;

function errorBody(code: CorrelationErrorCode, message: string): CorrelationError {
  return { code, message };
}

function jsonResponse(
  body: CorrelateEvidenceResponse,
  status: number
): Response {
  return Response.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function mapBedrockRuntimeFailure(error: BedrockRuntimeError): CorrelationError {
  switch (error.kind) {
    case "model_unavailable":
      return errorBody(
        "BEDROCK_REQUEST_FAILED",
        "The configured model is not available for this request."
      );
    case "access_denied":
      return errorBody(
        "BEDROCK_REQUEST_FAILED",
        "Access to the configured model was denied."
      );
    case "throttled":
      return errorBody(
        "BEDROCK_REQUEST_FAILED",
        "The model service is busy. Try again in a moment."
      );
    case "service_unavailable":
      return errorBody(
        "BEDROCK_REQUEST_FAILED",
        "The model service is temporarily unavailable. Try again."
      );
    case "invalid_request":
      return errorBody(
        "BEDROCK_REQUEST_FAILED",
        "The model request was rejected by the service."
      );
    default:
      return errorBody(
        "BEDROCK_REQUEST_FAILED",
        "AI correlation failed. Try again."
      );
  }
}

function mapOpenRouterRuntimeFailure(
  error: OpenRouterRuntimeError
): CorrelationError {
  switch (error.kind) {
    case "model_unavailable":
      return errorBody(
        "OPENROUTER_REQUEST_FAILED",
        "The configured model is not available on OpenRouter."
      );
    case "access_denied":
      return errorBody(
        "OPENROUTER_REQUEST_FAILED",
        "OpenRouter API key is invalid or access was denied."
      );
    case "throttled":
      return errorBody(
        "OPENROUTER_REQUEST_FAILED",
        "OpenRouter request was rate-limited. Try again shortly."
      );
    case "service_unavailable":
      return errorBody(
        "OPENROUTER_REQUEST_FAILED",
        "OpenRouter is temporarily unavailable. Try again."
      );
    case "invalid_request":
      return errorBody(
        "OPENROUTER_REQUEST_FAILED",
        "The request was rejected by OpenRouter."
      );
    default:
      return errorBody(
        "OPENROUTER_REQUEST_FAILED",
        "AI correlation failed. Try again."
      );
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: CorrelateEvidenceRequest;
  try {
    const parsed = (await request.json()) as unknown;
    if (!isRecord(parsed)) {
      return jsonResponse(
        {
          ok: false,
          error: errorBody("INVALID_REQUEST", "The request body is invalid."),
        },
        400
      );
    }
    body = parsed as CorrelateEvidenceRequest;
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: errorBody("INVALID_REQUEST", "The request could not be read."),
      },
      400
    );
  }

  if (!isString(body.incidentId) || !isString(body.evidenceId)) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody(
          "MISSING_FIELD",
          "incidentId and evidenceId are required."
        ),
      },
      400
    );
  }

  if (!INCIDENT_ID_RE.test(body.incidentId)) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody(
          "INCIDENT_NOT_FOUND",
          "The incident id is not valid."
        ),
      },
      400
    );
  }

  if (!EVIDENCE_ID_RE.test(body.evidenceId)) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody("EVIDENCE_NOT_FOUND", "The evidence id is not valid."),
      },
      400
    );
  }

  if (!isRecord(body.evidence)) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody(
          "MISSING_FIELD",
          "The evidence claim is required."
        ),
      },
      400
    );
  }

  const claim = body.evidence;
  if (claim.id !== body.evidenceId || claim.incidentId !== body.incidentId) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody(
          "EVIDENCE_INCIDENT_MISMATCH",
          "The evidence does not belong to this incident."
        ),
      },
      400
    );
  }

  const extraction = claim.extraction;
  if (!isRecord(extraction)) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody(
          "EXTRACTION_NOT_AVAILABLE",
          "No extracted text is available for this evidence."
        ),
      },
      400
    );
  }

  const textValue = extraction.text;
  if (!isString(textValue) || textValue.trim().length === 0) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody(
          "EXTRACTION_NOT_AVAILABLE",
          "No extracted text is available for this evidence."
        ),
      },
      400
    );
  }

  if (textValue.length > CORRELATION_HARD_LIMIT_CHARS) {
    return jsonResponse(
      {
        ok: false,
        error: errorBody(
          "INVALID_REQUEST",
          "The extracted text exceeds the supported correlation size limit."
        ),
      },
      413
    );
  }

  const filename = isString(claim.filename) ? claim.filename : "evidence";
  const mimeType = isString(claim.mimeType)
    ? claim.mimeType
    : "application/octet-stream";
  const category = isString(claim.category) ? claim.category : "unclassified";
  const capturedAt = isString(claim.capturedAt) ? claim.capturedAt : undefined;
  const extractedAt = isString(extraction.extractedAt)
    ? extraction.extractedAt
    : undefined;

  try {
    const result = await correlateEvidenceText({
      incidentId: body.incidentId,
      evidenceId: body.evidenceId,
      filename,
      mimeType,
      category,
      capturedAt,
      extractedAt,
      text: textValue,
    });

    return jsonResponse(
      {
        ok: true,
        evidenceId: body.evidenceId,
        correlation: {
          status: "correlated",
          modelId: result.modelId,
          correlatedAt: new Date().toISOString(),
          durationMs: result.durationMs,
          textLength: result.textLength,
          analysis: result.analysis,
          provider: result.provider,
          providerMode: result.providerMode,
        },
      },
      200
    );
  } catch (error) {
    if (error instanceof CorrelationServiceError) {
      const status =
        error.code === "BEDROCK_NOT_CONFIGURED" ||
        error.code === "OPENROUTER_NOT_CONFIGURED"
          ? 503
          : error.code === "BEDROCK_REQUEST_FAILED" ||
              error.code === "BEDROCK_INVALID_OUTPUT" ||
              error.code === "OPENROUTER_REQUEST_FAILED" ||
              error.code === "OPENROUTER_INVALID_OUTPUT"
            ? 502
            : 400;
      return jsonResponse({ ok: false, error: error.toError() }, status);
    }
    if (error instanceof BedrockRuntimeError) {
      return jsonResponse(
        { ok: false, error: mapBedrockRuntimeFailure(error) },
        502
      );
    }
    if (error instanceof OpenRouterRuntimeError) {
      return jsonResponse(
        { ok: false, error: mapOpenRouterRuntimeFailure(error) },
        502
      );
    }
    return jsonResponse(
      {
        ok: false,
        error: errorBody(
          "BEDROCK_REQUEST_FAILED",
          "AI correlation failed. Try again."
        ),
      },
      502
    );
  }
}
