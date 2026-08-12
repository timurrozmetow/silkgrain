import type { ApiError, ErrorCode } from '@silkgrain/contracts';

/**
 * The admin's transport.
 *
 * Deliberately not shared with the storefront's. The two authentication contours are separate by
 * design - separate tables, separate cookies, separate token audiences - and the one place that
 * difference has to live is the refresh call. A shared client would need a mode flag, and a mode
 * flag on an auth client is how an admin token ends up on a customer route.
 */

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK';
  readonly details: unknown;

  constructor(status: number, code: ErrorCode | 'NETWORK', message: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object'
  );
}

/**
 * The access token, in memory only, and the hook that mints a new one.
 *
 * An admin token is the more dangerous of the two to leave lying about, so it gets the same
 * treatment as the customer's and no storage at all: fifteen minutes, in a module variable, gone
 * on reload. What survives a reload is the httpOnly refresh cookie, which no script can read.
 */
let accessToken: string | null = null;
let refresher: (() => Promise<string | null>) | null = null;
let refreshing: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function registerTokenRefresher(fn: (() => Promise<string | null>) | null): void {
  refresher = fn;
}

/** One refresh at a time: a rotated refresh token replayed revokes the whole session family. */
function refreshOnce(): Promise<string | null> {
  if (!refresher) return Promise.resolve(null);
  refreshing ??= refresher().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function request<Result>(
  path: string,
  init: RequestInit,
  allowRetry = true,
): Promise<Result> {
  const sent = accessToken;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(sent ? { Authorization: `Bearer ${sent}` } : {}),
        ...(init.headers as Record<string, string>),
      },
      credentials: 'include',
    });
  } catch (cause) {
    throw new ApiRequestError(0, 'NETWORK', 'Could not reach the server', cause);
  }

  // A guarded call whose token expired mid-session: refresh once and replay. Only when a token
  // was actually sent, and only once, so a revoked session fails rather than looping.
  if (response.status === 401 && sent && allowRetry) {
    const renewed = await refreshOnce();
    if (renewed) return request<Result>(path, init, false);
  }

  if (response.status === 204) return undefined as Result;

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (isApiError(body)) {
      throw new ApiRequestError(
        response.status,
        body.error.code,
        body.error.message,
        body.error.details,
      );
    }
    throw new ApiRequestError(response.status, 'INTERNAL', 'Something went wrong');
  }

  return body as Result;
}

export function apiGet<Result>(path: string, signal?: AbortSignal): Promise<Result> {
  return request<Result>(path, { method: 'GET', ...(signal ? { signal } : {}) });
}

export function apiPost<Result>(path: string, body: unknown): Promise<Result> {
  return request<Result>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function apiPut<Result>(path: string, body: unknown): Promise<Result> {
  return request<Result>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
