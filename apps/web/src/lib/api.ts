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

async function request<Result>(path: string, init: RequestInit): Promise<Result> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init.headers as Record<string, string>) },
      // The refresh cookie is scoped to /api/auth, but the browser still needs permission to
      // send it at all.
      credentials: 'include',
    });
  } catch (cause) {
    // A dropped connection is not an API error and has no code, but every caller has to be
    // able to tell the customer something, so it arrives in the same shape as one.
    throw new ApiRequestError(0, 'NETWORK', 'Could not reach the server', cause);
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
