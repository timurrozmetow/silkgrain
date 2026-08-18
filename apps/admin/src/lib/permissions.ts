import { type AdminPermission, can } from '@silkgrain/contracts';

import { useAuth } from '../store/auth';

/**
 * What the signed-in administrator may do.
 *
 * Reads the same `ADMIN_PERMISSIONS` table the Fastify guards resolve against (D-30), so a control
 * the API would refuse cannot be drawn. Nothing crosses the wire to make this work: the profile
 * already carries the role, and the table is plain TypeScript in `packages/contracts`.
 *
 * The role can be up to fifteen minutes stale, which is the same window the API accepts. A demoted
 * manager therefore sees manager controls until their token refreshes and the API refuses them in
 * the meantime - the one exception being `team:manage`, which the server re-reads on every request.
 */
export function useCan(permission: AdminPermission): boolean {
  const role = useAuth((state) => state.admin?.role);
  return role !== undefined && can(role, permission);
}
