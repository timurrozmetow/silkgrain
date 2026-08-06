import type { ApiError, ErrorCode } from '@silkgrain/contracts';

/**
 * The one place the storefront talks to the API.
 *
 * Response types come from `@silkgrain/contracts` through `z.infer`, not from a hand-written
 * interface, and they are not re-parsed here: the server already validates its own output
 * through the same schema on the way out, and running Zod again in the browser would buy a
 * second opinion at the cost of shipping the schema layer to every visitor.
 *
 * Requests go to a relative `/api`, which Vite proxies in development and Nginx serves from
 * the same origin in production. No base URL, so no environment variable that can point a
 * production build at a development API.
 */

/** Everything the platform can go wrong with, carried in the shape `ApiError` declares. */
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
 * The access token, and the one hook that can mint a new one.
 *
 * The token lives in a module variable rather than in a header baked into every call, because
 * it changes: it is fifteen minutes long and rotates, and a closure captured at call time would
 * send yesterday's. The auth store owns it and pushes each new value here (decision D-15 keeps
 * it in memory, never in storage a script on another tab could read).
 *
 * `refresher` is registered by the same store. When a guarded call comes back 401 - the token
 * expired mid-session - the transport asks the refresher for a fresh one and replays the call
 * exactly once. The refresher talks to `/auth/refresh` with its own `fetch`, not through
 * `request`, so an expired session cannot send it looping back through here.
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

/** One refresh in flight at a time: three 401s at once must not rotate the token three times. */
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
      // The refresh cookie is scoped to /api/auth, but the browser still needs permission to
      // send it at all.
      credentials: 'include',
    });
  } catch (cause) {
    // A dropped connection is not an API error and has no code, but every caller has to be
    // able to tell the customer something, so it arrives in the same shape as one.
    throw new ApiRequestError(0, 'NETWORK', 'Could not reach the server', cause);
  }

  // A guarded call whose token expired mid-session: refresh once and replay. Only when a token
  // was actually sent, so a public 401 is never mistaken for an expired session, and only once,
  // so a genuinely revoked session fails instead of looping.
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

/**
 * Builds a query string from a filter object.
 *
 * Arrays repeat the key rather than joining with commas, because that is the form
 * `ProductListQuery` documents first and the form a browser produces from a checkbox group.
 * `undefined` and empty arrays are dropped so a cleared filter leaves no trace in the URL.
 */
export function queryString(
  params: Record<string, string | number | boolean | string[] | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) search.append(key, entry);
    } else {
      search.set(key, String(value));
    }
  }
  const rendered = search.toString();
  return rendered.length > 0 ? `?${rendered}` : '';
}
