import type {
  CompleteResponseActionResult,
  GetResponseResult,
  IncidentResponseView,
  ResponseError,
  StartResponseResult,
} from "@/types";

function readError(data: unknown): ResponseError {
  if (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof (data as { error?: unknown }).error === "object" &&
    (data as { error?: unknown }).error !== null
  ) {
    const error = (data as { error: Partial<ResponseError> }).error;
    return {
      code: error.code ?? "STEP_FUNCTIONS_REQUEST_FAILED",
      message: error.message ?? "The response workflow could not be reached.",
    };
  }
  return {
    code: "STEP_FUNCTIONS_REQUEST_FAILED",
    message: "The response workflow could not be reached.",
  };
}

function readResponse(data: unknown): IncidentResponseView | null {
  if (
    typeof data === "object" &&
    data !== null &&
    "response" in data &&
    typeof (data as { response: unknown }).response === "object" &&
    (data as { response: unknown }).response !== null
  ) {
    return (data as { response: IncidentResponseView }).response;
  }
  return null;
}

async function requestJson(
  url: string,
  init?: RequestInit
): Promise<{ data: unknown; ok: boolean }> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return { data: null, ok: false };
  }
  const data = await response.json().catch(() => null);
  return { data, ok: response.ok };
}

export const responseService = {
  async getResponse(incidentId: string): Promise<GetResponseResult> {
    const { data, ok } = await requestJson(
      `/api/incidents/${encodeURIComponent(incidentId)}/response`,
      { headers: { Accept: "application/json" } }
    );
    if (!ok) return { ok: false, error: readError(data) };
    const response = readResponse(data);
    if (!response) {
      return {
        ok: false,
        error: {
          code: "STEP_FUNCTIONS_REQUEST_FAILED",
          message: "The response workflow returned an unreadable response.",
        },
      };
    }
    return { ok: true, response };
  },

  async startResponse(incidentId: string): Promise<StartResponseResult> {
    const { data, ok } = await requestJson(
      `/api/incidents/${encodeURIComponent(incidentId)}/response/start`,
      { method: "POST", headers: { Accept: "application/json" } }
    );
    if (!ok) return { ok: false, error: readError(data) };
    const response = readResponse(data);
    if (!response) {
      return {
        ok: false,
        error: {
          code: "STEP_FUNCTIONS_REQUEST_FAILED",
          message: "The response workflow returned an unreadable response.",
        },
      };
    }
    return { ok: true, response };
  },

  async completeAction(
    incidentId: string,
    actionId: string
  ): Promise<CompleteResponseActionResult> {
    const { data, ok } = await requestJson(
      `/api/incidents/${encodeURIComponent(incidentId)}/response/actions/${encodeURIComponent(actionId)}/complete`,
      { method: "POST", headers: { Accept: "application/json" } }
    );
    if (!ok) return { ok: false, error: readError(data) };
    const response = readResponse(data);
    if (!response) {
      return {
        ok: false,
        error: {
          code: "STEP_FUNCTIONS_REQUEST_FAILED",
          message: "The response workflow returned an unreadable response.",
        },
      };
    }
    return { ok: true, response };
  },
};