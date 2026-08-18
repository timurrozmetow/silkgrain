import type { AdminRole } from '@silkgrain/contracts';
import type { FastifyRequest } from 'fastify';

import { unauthorized } from '../../lib/errors';

/**
 * Who is making this request.
 *
 * Every admin route runs behind `requirePermission`, so by the time a handler executes the claims
 * are present and `typ` is `admin` - but `request.auth` is typed for both contours, and each
 * handler that needed the id was narrowing it inline. One narrow, in one place, is what the audit
 * log will hang off as well: it records the actor's id and role, and both come from here.
 *
 * The name does not: it is read from `admin_users` when an entry is written, because the token
 * carries no name and a stale one copied into a log entry would be worse than a lookup.
 */
export interface AdminActor {
  id: number;
  role: AdminRole;
}

export function adminActor(request: FastifyRequest): AdminActor {
  const auth = request.auth;
  // Unreachable behind the guards; a 401 rather than a throw so a future unguarded route fails
  // as "not signed in" instead of as an internal error.
  if (auth?.typ !== 'admin') throw unauthorized('No administrator');
  return { id: auth.sub, role: auth.role };
}

/**
 * Where the request came from, for the two columns `audit_log` already has.
 *
 * These are personal data about staff rather than customers, and they are what turns "somebody
 * cancelled forty orders" into an answerable question. Clamped at the writer, not here, so one
 * file owns every column width.
 */
export function auditContext(request: FastifyRequest): {
  ip: string | null;
  userAgent: string | null;
} {
  return {
    ip: request.ip || null,
    userAgent: request.headers['user-agent'] ?? null,
  };
}
