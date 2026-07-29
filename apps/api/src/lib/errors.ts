import { ERROR_STATUS, type ErrorCode } from '@silkgrain/contracts';

/**
 * The only error type handlers throw on purpose.
 *
 * Carrying the `ErrorCode` rather than an HTTP status means the status is looked up from one
 * table (`ERROR_STATUS`) instead of being chosen at each throw site, so `INSUFFICIENT_STOCK`
 * cannot be a 422 in one route and a 409 in the next.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: unknown;
  /** Set when the cause should reach the log but not the response. */
  override readonly cause: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: unknown; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = ERROR_STATUS[code];
    this.details = options.details;
    this.cause = options.cause;
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError('VALIDATION_FAILED', message, { details });

export const unauthorized = (message = 'Authentication required'): AppError =>
  new AppError('UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have access to this resource'): AppError =>
  new AppError('FORBIDDEN', message);

export const notFound = (what = 'Resource'): AppError =>
  new AppError('NOT_FOUND', `${what} not found`);

export const conflict = (message: string, details?: unknown): AppError =>
  new AppError('CONFLICT', message, { details });

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
