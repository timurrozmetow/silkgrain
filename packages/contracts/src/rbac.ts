import type { AdminRole } from './enums';

/**
 * Who may do what in the back office.
 *
 * One table, two consumers: the Fastify guards resolve a route's permission from it, and the panel
 * decides what to draw from it. The alternative was a role list at every route plus a hand-written
 * mirror in React - `role === 'owner' || role === 'manager'` in a dozen components - which is the
 * "two hand-maintained copies" the working agreement already bans for schemas. The panel must not
 * offer a control the API will refuse, and this is the only way to guarantee that by construction.
 *
 * Plain TypeScript, not Zod: it never crosses the wire. The client derives its own permissions from
 * the role its profile already carries, so there is nothing to validate on arrival.
 *
 * It is deliberately not a capability layer. There are no per-user grants, no permissions column,
 * no database lookup and no runtime resolution - roles map to permissions statically, and changing
 * the map is a code change. For three roles in one shop, anything more is ceremony.
 *
 * Decision D-30.
 */

export const ADMIN_PERMISSION = [
  'dashboard:read',
  'products:read',
  'products:write',
  'orders:read',
  'orders:write',
  /** Cancelling returns committed stock and leaves a paid customer owed money. */
  'orders:cancel',
  'wholesale:read',
  'wholesale:write',
  'customers:read',
  'customers:block',
  'promos:read',
  'promos:write',
  'pricing:bulk',
  'settings:read',
  'settings:write',
  /** The half of the settings payload that answers "why was I charged postage". */
  'shipping:read',
  'users:read',
  'audit:read',
  'team:manage',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSION)[number];

/**
 * The matrix.
 *
 * `support` reads everything a support ticket asks about and writes only what answering one
 * requires: an order's status, its tracking, its internal note, and an enquiry. It does not touch
 * the catalogue, prices, promo codes or settings.
 *
 * Two rows reverse what earlier phases built, and both were reversals of the built code rather than
 * of Q-29:
 *
 * - `settings:read` is owner and manager. `loadSettings` is an unfiltered read of a table whose own
 *   schema comment says a non-public row is where an API key would live, and the seed already
 *   carries one internal address. `shipping:read` exists so support keeps the half it needs (D-31).
 * - `pricing:bulk` covers the preview as well as the apply. A preview is not a report - it is step
 *   one of a two-step write, and no support ticket is answered by "what would a ten per cent markup
 *   do". Leaving it open would put a screen in reach whose only button is refused.
 *
 * `settings:write` covers the shipping-rate write too: D-22 makes that row the authority on free
 * shipping, which is a store manager's job, not an owner's.
 */
export const ADMIN_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = {
  owner: ADMIN_PERMISSION,
  manager: [
    'dashboard:read',
    'products:read',
    'products:write',
    'orders:read',
    'orders:write',
    'orders:cancel',
    'wholesale:read',
    'wholesale:write',
    'customers:read',
    'customers:block',
    'promos:read',
    'promos:write',
    'pricing:bulk',
    'settings:read',
    'settings:write',
    'shipping:read',
    'users:read',
    'audit:read',
  ],
  support: [
    'dashboard:read',
    'products:read',
    'orders:read',
    'orders:write',
    'wholesale:read',
    'wholesale:write',
    'customers:read',
    'promos:read',
    'shipping:read',
    'users:read',
  ],
};

export function can(role: AdminRole, permission: AdminPermission): boolean {
  return ADMIN_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: AdminRole): readonly AdminPermission[] {
  return ADMIN_PERMISSIONS[role];
}

/**
 * The one permission no fifteen-minute-stale token may carry.
 *
 * Every other permission merely delays: a manager demoted to support keeps manager powers until
 * their access token expires, which is the bargain a short-lived stateless token exists to make.
 * `team:manage` breaks that bargain, because inside the window it can mint a permanent replacement
 * - a demoted owner creates a second owner account, and the demotion is undone. Its routes re-read
 * `admin_users` in the guard. Decision D-32.
 */
export const FRESH_PERMISSION: readonly AdminPermission[] = ['team:manage'];

export function needsFreshRole(permission: AdminPermission): boolean {
  return FRESH_PERMISSION.includes(permission);
}
