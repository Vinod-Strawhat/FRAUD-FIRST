import type {
  CorrelationError,
  CorrelationErrorCode,
} from "@/types";

export class CorrelationServiceError extends Error {
  readonly code: CorrelationErrorCode;

  constructor(code: CorrelationErrorCode, message: string) {
    super(message);
    this.name = "CorrelationServiceError";
    this.code = code;
  }

  toError(): CorrelationError {
    return { code: this.code, message: this.message };
  }
}