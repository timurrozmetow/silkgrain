import { describe, expect, it } from 'vitest';

import {
  ADMIN_PERMISSION,
  ADMIN_PERMISSIONS,
  FRESH_PERMISSION,
  can,
  needsFreshRole,
  permissionsFor,
} from './rbac';

/**
 * The permission table, as a table.
 *
 * `apps/api` already asserts that the routes enforce this - it walks every registered admin route
 * and calls it with all three roles. What that cannot check is the table's own shape, because a
 * route sweep only sees the permissions some route happens to name. These are the properties the
 * table has to hold on its own, and they are pure, so they belong beside it.
 */
describe('the permission table', () => {
  it('gives every role a defined set, and the owner all of it', () => {
    for (const role of ['owner', 'manager', 'support'] as const) {
      expect(permissionsFor(role).length).toBeGreaterThan(0);
    }
    for (const permission of ADMIN_PERMISSION) {
      expect(can('owner', permission)).toBe(true);
    }
  });

  it('names no permission twice', () => {
    // A duplicate would be harmless today and confusing forever: two entries, one of which
    // somebody edits.
    expect(new Set(ADMIN_PERMISSION).size).toBe(ADMIN_PERMISSION.length);
    for (const role of ['owner', 'manager', 'support'] as const) {
      const granted = permissionsFor(role);
      expect(new Set(granted).size).toBe(granted.length);
    }
  });

  it('grants nothing that is not a permission', () => {
    // Guards against a typo'd string sitting in a role's list and silently granting nothing -
    // or, worse, reading as though it grants something.
    for (const role of ['owner', 'manager', 'support'] as const) {
      for (const permission of permissionsFor(role)) {
        expect(ADMIN_PERMISSION).toContain(permission);
      }
    }
  });

  it('nests the roles: support inside manager inside owner', () => {
    // Not a law of RBAC in general, but it is the shape this shop has, and a violation would
    // almost certainly be a typo rather than a decision somebody made.
    for (const permission of ADMIN_PERMISSIONS.support) {
      expect(can('manager', permission)).toBe(true);
    }
    for (const permission of ADMIN_PERMISSIONS.manager) {
      expect(can('owner', permission)).toBe(true);
    }
  });

  it('reserves exactly one permission to the owner', () => {
    const ownerOnly = ADMIN_PERMISSION.filter((permission) => !can('manager', permission));
    expect(ownerOnly).toEqual(['team:manage']);
  });

  it('withholds from support what a support desk has no business doing', () => {
    // Written out rather than counted, so widening support is a deliberate edit to this list and
    // not a diff nobody reads.
    const withheld = ADMIN_PERMISSION.filter((permission) => !can('support', permission));
    expect(withheld).toEqual([
      'products:write',
      'orders:cancel',
      'customers:block',
      'promos:write',
      // `content:read` is granted and absent from this list on purpose: answering a ticket means
      // quoting the FAQ back at somebody, and a support desk that cannot read it looks it up on
      // the public site instead.
      'content:write',
      'pricing:bulk',
      'settings:read',
      'settings:write',
      'audit:read',
      'team:manage',
    ]);
  });

  it('requires a fresh role only where a stale one could make itself permanent', () => {
    // Every other permission merely delays inside the fifteen-minute token window. `team:manage`
    // can mint a replacement owner inside it, which is why it is the only one (D-32).
    expect(FRESH_PERMISSION).toEqual(['team:manage']);
    expect(needsFreshRole('team:manage')).toBe(true);
    expect(needsFreshRole('settings:write')).toBe(false);
    expect(needsFreshRole('orders:cancel')).toBe(false);
  });

  it('keeps the owner-only permission out of every other role', () => {
    for (const permission of FRESH_PERMISSION) {
      expect(can('manager', permission)).toBe(false);
      expect(can('support', permission)).toBe(false);
    }
  });
});
