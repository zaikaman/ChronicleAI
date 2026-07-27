// Shared repository error types and result helpers

export class RepositoryError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 500) {
    super(message);
    this.name = "RepositoryError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends RepositoryError {
  constructor(entity: string, id: string) {
    super("NOT_FOUND", `${entity} not found: ${id}`, 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends RepositoryError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
    this.name = "ConflictError";
  }
}

export class ValidationError extends RepositoryError {
  constructor(message: string) {
    super("VALIDATION", message, 422);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends RepositoryError {
  constructor(message = "Unauthorized") {
    super("UNAUTHORIZED", message, 401);
    this.name = "UnauthorizedError";
  }
}

export class PersistenceError extends RepositoryError {
  constructor(message: string, cause?: unknown) {
    super("PERSISTENCE", message, 500);
    this.name = "PersistenceError";
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

// ── Result Type ─────────────────────────────────────────
export type Result<T, E = RepositoryError> = { ok: true; value: T } | { ok: false; error: E };

export function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function failure<E extends RepositoryError>(error: E): Result<never, E> {
  return { ok: false, error };
}
