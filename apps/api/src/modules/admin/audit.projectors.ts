import type {
  adminUsers,
  customers,
  orders,
  productImages,
  productVariants,
  products,
  promoCodes,
  shippingRates,
  wholesaleRequests,
} from '../../db/schema';

import type { AuditPayload, AuditValue } from './audit.diff';

/**
 * What each entity looks like to the log.
 *
 * Every projector is a literal object naming its columns one at a time. That is the whole security
 * model of this file: a spread would archive every column a table ever grows, including the next
 * credential somebody adds, and the `audit_log` comment has promised since Phase 2 that "a password
 * hash or a card detail cannot end up archived here by accident". An allow-list keeps that promise
 * by construction; a deny-list would only keep it until somebody forgot to extend it.
 *
 * The fields chosen are the ones a person would ask about a month later. A product's timestamps are
 * absent because "updatedAt changed" is what every entry would say and none would mean.
 */

const iso = (value: Date | null): AuditValue => value?.toISOString() ?? null;

export function productSnapshot(row: typeof products.$inferSelect): AuditPayload {
  return {
    name: row.name,
    slug: row.slug,
    status: row.status,
    categoryId: row.categoryId,
    origin: row.origin,
    originRegion: row.originRegion,
    isFeatured: row.isFeatured,
    blurb: row.blurb,
    subtitle: row.subtitle,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    publishedAt: iso(row.publishedAt),
    // `description` and `story` are deliberately absent: they are paragraphs, and a diff of two
    // paragraphs is not a diff anybody reads. That a product's copy changed is recorded by the
    // entry existing; what it changed to is in the product.
  };
}

export function variantSnapshot(row: typeof productVariants.$inferSelect): AuditPayload {
  return {
    sku: row.sku,
    weightLabel: row.weightLabel,
    priceCents: row.priceCents,
    compareAtPriceCents: row.compareAtPriceCents,
    costCents: row.costCents,
    stockQty: row.stockQty,
    lowStockThreshold: row.lowStockThreshold,
    isDefault: row.isDefault,
    isActive: row.isActive,
  };
}

export function imageSnapshot(row: typeof productImages.$inferSelect): AuditPayload {
  return {
    url: row.url,
    alt: row.alt,
    position: row.position,
    isPrimary: row.isPrimary,
  };
}

export function orderSnapshot(row: typeof orders.$inferSelect): AuditPayload {
  return {
    status: row.status,
    carrier: row.carrier,
    trackingNumber: row.trackingNumber,
    trackingUrl: row.trackingUrl,
    adminNote: row.adminNote,
    shippedAt: iso(row.shippedAt),
    deliveredAt: iso(row.deliveredAt),
    cancelledAt: iso(row.cancelledAt),
    // No money: an order's totals are written once by the checkout and never edited here, so a
    // field that cannot change is noise in a log of changes.
  };
}

export function customerSnapshot(row: typeof customers.$inferSelect): AuditPayload {
  // Status is the only thing the panel may change about a customer, so it is the only thing
  // recorded. The email is carried as the label, not as a field, so blocking somebody does not
  // archive their address in a second place.
  return { status: row.status };
}

export function promoSnapshot(row: typeof promoCodes.$inferSelect): AuditPayload {
  return {
    code: row.code,
    description: row.description,
    type: row.type,
    value: row.value,
    minOrderCents: row.minOrderCents,
    maxDiscountCents: row.maxDiscountCents,
    usageLimit: row.usageLimit,
    usageLimitPerCustomer: row.usageLimitPerCustomer,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    isActive: row.isActive,
    // `usedCount` is absent: it is an accounting fact the paid transaction writes, not something
    // an operator changed, and logging it would attribute a customer's redemption to whoever
    // happened to edit the code next.
  };
}

export function shippingRateSnapshot(row: typeof shippingRates.$inferSelect): AuditPayload {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    freeAboveCents: row.freeAboveCents,
    estimatedDaysMin: row.estimatedDaysMin,
    estimatedDaysMax: row.estimatedDaysMax,
    isActive: row.isActive,
    position: row.position,
  };
}

export function wholesaleSnapshot(row: typeof wholesaleRequests.$inferSelect): AuditPayload {
  // Only the two fields triage touches. The enquiry's own contents are the customer's words and
  // are not an administrator's change to record.
  return { status: row.status, assignedToId: row.assignedToId };
}

export function adminUserSnapshot(row: typeof adminUsers.$inferSelect): AuditPayload {
  return {
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.isActive,
    // `passwordHash` is on the row and is not named here. That is the point of the file.
  };
}

/**
 * A settings save, keyed by setting key.
 *
 * One entry covers the whole card the operator pressed Save on, so the payload is a map of the
 * keys that moved rather than one entry per key.
 */
export function settingsSnapshot(values: Record<string, unknown>): AuditPayload {
  const payload: AuditPayload = {};
  for (const [key, value] of Object.entries(values)) {
    payload[key] =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? value
        : // A JSON column can hold anything; anything that is not a scalar is recorded as the
          // text it serialises to rather than dropped, so the entry stays honest.
          JSON.stringify(value ?? null);
  }
  return payload;
}
