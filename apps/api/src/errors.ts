// Centralized API error classes and response mapping

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly publicMessage: string;
  public readonly details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.publicMessage = message;
    this.details = details;
  }
}

// ── Helpers ─────────────────────────────────────────────
export function badRequest(message: string, details?: unknown): ApiError {
  return new ApiError(400, message, details);
}

export function unauthorized(message = "Unauthorized"): ApiError {
  return new ApiError(401, message);
}

export function forbidden(message = "Forbidden"): ApiError {
  return new ApiError(403, message);
}

export function notFound(message = "Resource not found"): ApiError {
  return new ApiError(404, message);
}

export function conflict(message: string): ApiError {
  return new ApiError(409, message);
}

export function unprocessable(message: string, details?: unknown): ApiError {
  return new ApiError(422, message, details);
}

export function internal(message = "Internal server error"): ApiError {
  return new ApiError(500, message);
}
