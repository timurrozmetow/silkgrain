import { eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { addresses, orderItems, orders, productVariants } from '../../db/schema';

import type { CatalogFixture } from './catalog';

/**
 * A `pending` order, in the state `POST /api/checkout/intent` leaves one.
 *
 * The webhook tests need an order to settle without depending on the checkout route, so that a
 * failure in one is not a failure in both. Totals are stated rather than computed, for the
 * same reason the catalogue fixture states its own: an expected value worked out by the code
 * under test proves nothing.
 */

export interface PendingOrderSpec {
  orderNumber?: string;
  email?: string;
  customerId?: number | null;
  lines?: { variantId: number; qty: number; unitPriceCents: number }[];
  promoCode?: string | null;
  promoDiscountCents?: number;
  shippingCents?: number;
  taxCents?: number;
}

export interface PendingOrder {
  id: number;
  orderNumber: string;
  email: string;
  subtotalCents: number;
  totalCents: number;
  lines: { variantId: number; qty: number; stockBefore: number }[];
}

export async function seedPendingOrder(
  db: Database,
  fixture: CatalogFixture,
  spec: PendingOrderSpec = {},
): Promise<PendingOrder> {
  const lines = spec.lines ?? [
    { variantId: fixture.variants.devzira2lb, qty: 2, unitPriceCents: 1200 },
  ];

  const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.qty, 0);
  const discountCents = spec.promoDiscountCents ?? 0;
  const shippingCents = spec.shippingCents ?? 799;
  // The cart's expression, and the one Phase 3's tests assert: Texas taxes shipping.
  const taxable = subtotalCents - discountCents + shippingCents;
  const taxCents = spec.taxCents ?? Math.round((taxable * 825) / 10_000);
  const totalCents = taxable + taxCents;

  const email = spec.email ?? 'buyer@example.com';
  const orderNumber = spec.orderNumber ?? 'SG-2026-09001';

  const [orderRow] = await db
    .insert(orders)
    .values({
      orderNumber,
      email,
      customerId: spec.customerId ?? null,
      status: 'pending',
      subtotalCents,
      discountCents,
      shippingCents,
      taxCents,
      totalCents,
      promoCode: spec.promoCode ?? null,
      promoDiscountCents: discountCents,
      shippingMethod: 'standard',
    })
    .$returningId();
  if (!orderRow) throw new Error('fixture: the pending order was not inserted');

  const recorded: PendingOrder['lines'] = [];

  for (const line of lines) {
    const [variant] = await db
      .select({
        id: productVariants.id,
        productId: productVariants.productId,
        sku: productVariants.sku,
        weightLabel: productVariants.weightLabel,
        stockQty: productVariants.stockQty,
      })
      .from(productVariants)
      .where(eq(productVariants.id, line.variantId));
    if (!variant) throw new Error(`fixture: no variant ${String(line.variantId)}`);

    await db.insert(orderItems).values({
      orderId: orderRow.id,
      productId: variant.productId,
      variantId: variant.id,
      productSlug: 'devzira-rice',
      name: 'Devzira Red Rice',
      sku: variant.sku,
      weightLabel: variant.weightLabel,
      imageUrl: 'https://images.example.com/devzira-rice.jpg',
      unitPriceCents: line.unitPriceCents,
      qty: line.qty,
      lineTotalCents: line.unitPriceCents * line.qty,
    });

    recorded.push({ variantId: variant.id, qty: line.qty, stockBefore: variant.stockQty });
  }

  for (const type of ['shipping', 'billing'] as const) {
    await db.insert(addresses).values({
      orderId: orderRow.id,
      type,
      firstName: 'Nodira',
      lastName: 'Yusupova',
      line1: '5850 San Felipe St',
      city: 'Houston',
      state: 'TX',
      zip: '77057',
      country: 'US',
    });
  }

  return {
    id: orderRow.id,
    orderNumber,
    email,
    subtotalCents,
    totalCents,
    lines: recorded,
  };
}
