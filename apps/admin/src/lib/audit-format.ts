import type { AuditAction } from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';

/**
 * Rendering a stored audit value.
 *
 * The payload is JSON written by nine projectors, so nothing on the wire says which numbers are
 * money. The key does: the projectors name a cents column `priceCents`, and every money field in
 * this system ends that way. Guessing from the key is honest here in a way it would not be in a
 * price calculation - the worst case is a figure printed as `1299` rather than `$12.99`, whereas a
 * `Intl.NumberFormat` call would be an ESLint error and a second place currency is formatted.
 */
export type AuditValueKind = 'money' | 'basisPoints' | 'timestamp' | 'boolean' | 'text';

const ISO = /^\d{4}-\d{2}-\d{2}T/;

export function auditValueKind(key: string, value: unknown): AuditValueKind {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (key.endsWith('Cents')) return 'money';
    if (key.endsWith('BasisPoints') || key === 'commerce.default_tax_basis_points') {
      return 'basisPoints';
    }
  }
  if (typeof value === 'string' && ISO.test(value)) return 'timestamp';
  return 'text';
}

const WHEN = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** One value, as a person reads it. An empty field is an em dash, never the word "null". */
export function formatAuditValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';

  switch (auditValueKind(key, value)) {
    case 'money':
      // Through the Money value object, the only place currency is formatted (CLAUDE.md).
      return Money.fromCents(value as number).format();
    case 'basisPoints':
      return `${String((value as number) / 100)}%`;
    case 'timestamp':
      return WHEN.format(new Date(value as string));
    case 'boolean':
      return value === true ? 'Yes' : 'No';
    case 'text':
      return typeof value === 'string' ? value : JSON.stringify(value);
  }
}

/** What each action reads as in a sentence: "Sevara A. shipped SG-2026-00014". */
export const ACTION_PHRASE: Record<AuditAction, string> = {
  'product.created': 'created product',
  'product.updated': 'updated product',
  'product.image_added': 'added an image to',
  'product.image_updated': 'edited an image on',
  'product.images_arranged': 'reordered images on',
  'product.image_removed': 'removed an image from',
  'category.created': 'created category',
  'category.updated': 'updated category',
  'category.active_changed': 'switched category',
  'category.image_updated': 'changed the image on category',
  'category.image_removed': 'removed the image from category',
  'order.status_changed': 'changed the status of',
  'order.tracking_updated': 'updated tracking on',
  'order.note_updated': 'wrote an internal note on',
  'customer.status_changed': 'changed the status of customer',
  'promo.created': 'created promo code',
  'promo.updated': 'updated promo code',
  'promo.active_changed': 'switched promo code',
  'pricing.applied': 'applied a bulk price change to',
  'settings.updated': 'changed settings',
  'shipping_rate.updated': 'updated shipping rate',
  'wholesale.triaged': 'triaged the enquiry from',
  'admin_user.created': 'added administrator',
  'admin_user.updated': 'updated administrator',
  'admin_user.password_reset': 'reset the password of',
};
