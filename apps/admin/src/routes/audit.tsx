import type { AuditAction } from '@silkgrain/contracts';
import { AUDIT_ACTION } from '@silkgrain/contracts';
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from './root';

export interface AuditSearch {
  actor?: string;
  action?: AuditAction;
  before?: number;
}

const ACTIONS = new Set<string>(AUDIT_ACTION);

export const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit',
  validateSearch: (raw: Record<string, unknown>): AuditSearch => {
    const before = Number(raw['before']);
    const actor = raw['actor'];
    const action = raw['action'];

    return {
      ...(Number.isInteger(before) && before > 0 ? { before } : {}),
      // An id or the literal `deleted`; anything else is dropped rather than forwarded.
      ...(typeof actor === 'string' && (actor === 'deleted' || /^\d+$/.test(actor))
        ? { actor }
        : {}),
      ...(typeof action === 'string' && ACTIONS.has(action)
        ? { action: action as AuditAction }
        : {}),
    };
  },
  component: lazyRouteComponent(() => import('./audit.page')),
});
