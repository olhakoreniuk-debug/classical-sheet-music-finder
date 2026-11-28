import type { FieldError, Problem } from './types';

export type ApiErrorKind = 'problem' | 'network';

/** One error type for every failed API call, whatever the implementation. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP status, or null when the server could not be reached. */
  readonly status: number | null;
  /** The RFC 9457 Problem Details body, when the server sent one. */
  readonly problem: Problem | null;

  constructor(kind: ApiErrorKind, message: string, status: number | null, problem: Problem | null) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.problem = problem;
  }

  static fromProblem(problem: Problem): ApiError {
    return new ApiError('problem', problem.detail ?? problem.title, problem.status, problem);
  }

  static network(): ApiError {
    return new ApiError('network', 'The catalogue service could not be reached.', null, null);
  }

  get fieldErrors(): readonly FieldError[] {
    return this.problem?.errors ?? [];
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Checks that an unknown JSON value has the required Problem Details fields. */
export function isProblem(value: unknown): value is Problem {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['type'] === 'string' &&
    typeof candidate['title'] === 'string' &&
    typeof candidate['status'] === 'number'
  );
}

/** A short message suitable for showing to users. */
export function describeError(error: unknown): string {
  if (isApiError(error)) {
    if (error.kind === 'network') return 'The catalogue service could not be reached. Check that it is running and try again.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
