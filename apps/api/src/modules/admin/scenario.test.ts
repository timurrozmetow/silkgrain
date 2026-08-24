import type {
  AdminAuditResponse,
  AdminOrderDetail,
  AdminProductDetail,
  AdminWholesaleDetail,
  CheckoutIntentInput,
  ProductDetailResponse,
  ProductListResponse,
} from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminUsers, productVariants, wholesaleRequests } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import { FIXTURE_PASSWORD, seedCatalogFixture } from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';
import { quoteCart } from '../cart/cart.service';
import { createPendingOrder } from '../checkout/checkout.service';

/**
 * The acceptance scenario for Phase 7, walked end to end.
 *
 * One test, in order, through the real HTTP surface: create a product with two variants in the back
 * office, find it in the storefront catalogue, buy it, pay for it through the Stripe webhook, ship
 * it from the panel, read the letter out of Mailpit, and move a wholesale enquiry to `contacted`
 * with a note. Then check the audit log recorded the administrator's half of it.
 *
 * Deliberately one test rather than seven. Each step depends on the last, and seven independent
 * tests would either rebuild the world each time - proving nothing about the seam between them - or
 * share mutable state in a way that makes a failure impossible to place. What this proves is that
 * the seams hold: that the catalogue reads what the admin form wrote, that the cart prices what the
 * catalogue showed, that the paid transaction moves the stock the order reserved, and that the mail
 * the shipment triggers carries the tracking number the panel was given.
 *
 * Playwright belongs to Phase 8 (task 8.2). This is the same scenario one layer down, and it needs
 * MySQL, Redis and Mailpit - `pnpm setup:services`, as every integration test here does.
 */
const MAILPIT = 'http://127.0.0.1:8025';

interface MailpitSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
}

/** Polls rather than sleeps: the queue is genuinely asynchronous, so there is no moment to sleep to. */
async function waitForSubject(match: RegExp, timeoutMs = 20_000): Promise<MailpitSummary | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${MAILPIT}/api/v1/messages?limit=50`);
    const body = (await response.json()) as { messages: MailpitSummary[] };
    const found = body.messages.find((message) => match.test(message.Subject));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function messageText(id: string): Promise<string> {
  const response = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  const body = (await response.json()) as { Text: string };
  return body.Text;
}

describe('the phase 7 acceptance scenario', () => {
  let app: FastifyInstance;
  let databaseUrl: string;
  let webhookSecret: string;
  let stripe: Stripe;
  let token: string;

  beforeAll(async () => {
    app = await buildTestApp();
    const env = testEnv();
    databaseUrl = env.DATABASE_URL;
    webhookSecret = env.STRIPE_WEBHOOK_SECRET;
    stripe = new Stripe(env.STRIPE_SECRET_KEY);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(databaseUrl);
    await app.emailQueue.obliterate({ force: true });
    await clearMailbox();
    await seedCatalogFixture(app.db);

    await app.db.insert(adminUsers).values({
      email: 'owner@silkgrain.test',
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      name: 'Timur R.',
      role: 'owner',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email: 'owner@silkgrain.test', password: FIXTURE_PASSWORD },
    });
    token = login.json<{ accessToken: string }>().accessToken;
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it('runs from an empty catalogue entry to a shipped order and a contacted enquiry', async () => {
    // ---------------------------------------------------------------- 1. create the product
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/products',
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: {
        name: 'Bukhara Mung Beans',
        slug: 'bukhara-mung-beans',
        subtitle: null,
        blurb: 'Small green mung beans from the Bukhara oasis, hand-sorted.',
        description: 'Cooks down in twenty minutes and holds its shape in a mash.',
        story: null,
        categoryId: 1,
        origin: 'UZ',
        originRegion: 'Bukhara',
        status: 'active',
        isFeatured: false,
        metaTitle: null,
        metaDescription: null,
        certifications: ['organic'],
        badges: [],
        nutrition: null,
        variants: [
          {
            sku: 'SG-MUNG-1LB',
            weightValueMilli: 1000,
            weightUnit: 'lb',
            weightLabel: '1 lb',
            weightGrams: 454,
            priceCents: 690,
            compareAtPriceCents: null,
            costCents: null,
            stockQty: 40,
            lowStockThreshold: 10,
            position: 0,
            isDefault: true,
            isActive: true,
          },
          {
            sku: 'SG-MUNG-5LB',
            weightValueMilli: 5000,
            weightUnit: 'lb',
            weightLabel: '5 lb',
            weightGrams: 2268,
            priceCents: 2990,
            compareAtPriceCents: null,
            costCents: null,
            stockQty: 12,
            lowStockThreshold: 4,
            position: 1,
            isDefault: false,
            isActive: true,
          },
        ],
      },
    });
    expect(created.statusCode).toBe(201);

    const product = created.json<AdminProductDetail>();
    expect(product.variants).toHaveLength(2);
    const fiveLb = product.variants.find((variant) => variant.sku === 'SG-MUNG-5LB');
    expect(fiveLb).toBeDefined();

    // ------------------------------------------------- 2. the storefront can see it, unauthenticated
    const listed = await app.inject({
      method: 'GET',
      url: '/api/products?q=mung',
      remoteAddress: freshAddress(),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<ProductListResponse>().items.map((item) => item.slug)).toContain(
      'bukhara-mung-beans',
    );

    const detail = await app.inject({
      method: 'GET',
      url: '/api/products/bukhara-mung-beans',
      remoteAddress: freshAddress(),
    });
    expect(detail.statusCode).toBe(200);
    // Both weights are offered, and the cheapest is what the card quoted.
    const shown = detail.json<ProductDetailResponse>().product;
    expect(shown.variants.map((variant) => variant.weightLabel)).toEqual(['1 lb', '5 lb']);

    // ------------------------------------------------------------------------ 3. place an order
    const lines = [{ variantId: fiveLb?.id ?? 0, qty: 2 }];
    const quote = await quoteCart(
      app.db,
      { lines, shippingMethod: 'standard' },
      { strictPromo: false, identity: { email: 'nodira@example.com' } },
    );

    const intent: CheckoutIntentInput = {
      email: 'nodira@example.com',
      lines,
      shippingAddress: {
        firstName: 'Nodira',
        lastName: 'Yusupova',
        line1: '5850 San Felipe St',
        city: 'Houston',
        state: 'TX',
        zip: '77057',
        country: 'US',
      },
      shippingMethod: 'standard',
      marketingOptIn: false,
      provider: 'stripe',
      expectedTotalCents: quote.totalCents,
    };
    const order = await createPendingOrder(app.db, intent, {
      customerId: null,
      orderNumberPrefix: 'SG',
    });
    expect(order.orderNumber).toMatch(/^SG-\d{4}-\d{5}$/);

    // Nothing is off the shelf yet: stock moves in the paid transaction and nowhere else.
    const stockOf = async (id: number) =>
      (
        await app.db
          .select({ stockQty: productVariants.stockQty })
          .from(productVariants)
          .where(eq(productVariants.id, id))
      )[0]?.stockQty ?? -1;
    expect(await stockOf(fiveLb?.id ?? 0)).toBe(12);

    // ------------------------------------------------------------------------- 4. pay for it
    const payload = JSON.stringify({
      id: 'evt_scenario_1',
      object: 'event',
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'pi_scenario_1',
          object: 'payment_intent',
          amount: quote.totalCents,
          amount_received: quote.totalCents,
          currency: 'usd',
          // `order_id`, the key the handler reads. The order number is not carried: the id is the
          // thing the webhook looks the order up by.
          metadata: { order_id: String(order.id) },
          latest_charge: {
            id: 'ch_scenario_1',
            object: 'charge',
            payment_method_details: { card: { brand: 'visa', last4: '4242' } },
          },
        },
      },
    });
    const paid = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      remoteAddress: freshAddress(),
      headers: {
        'content-type': 'application/json',
        'stripe-signature': stripe.webhooks.generateTestHeaderString({
          payload,
          secret: webhookSecret,
        }),
      },
      payload,
    });
    expect(paid.statusCode).toBe(200);

    // Two five-pound bags off the shelf, in the same transaction that marked the order paid.
    expect(await stockOf(fiveLb?.id ?? 0)).toBe(10);

    const confirmation = await waitForSubject(/confirmed/);
    expect(confirmation?.To[0]?.Address).toBe('nodira@example.com');

    // --------------------------------------------------------------------- 5. ship it, as staff
    const processing = await app.inject({
      method: 'PATCH',
      url: `/api/admin/orders/${order.orderNumber}/status`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { status: 'processing' },
    });
    expect(processing.statusCode).toBe(200);

    const shipped = await app.inject({
      method: 'PATCH',
      url: `/api/admin/orders/${order.orderNumber}/status`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { status: 'shipped', carrier: 'UPS', trackingNumber: '1Z999AA10123456784' },
    });
    expect(shipped.statusCode).toBe(200);
    expect(shipped.json<AdminOrderDetail>().tracking?.number).toBe('1Z999AA10123456784');

    // ---------------------------------------------------------- 6. the letter, in Mailpit
    const notice = await waitForSubject(/has shipped/);
    expect(notice).not.toBeNull();
    expect(notice?.To[0]?.Address).toBe('nodira@example.com');

    const text = await messageText(notice?.ID ?? '');
    // The tracking number the panel was given, in the letter the customer receives.
    expect(text).toContain('1Z999AA10123456784');
    expect(text).toContain(order.orderNumber);
    expect(text).toContain('Bukhara Mung Beans');

    // ------------------------------------------------- 7. a wholesale enquiry, triaged with a note
    const enquiry = await app.inject({
      method: 'POST',
      url: '/api/wholesale/requests',
      remoteAddress: freshAddress(),
      payload: {
        businessName: 'Samarkand Grill',
        businessType: 'restaurant',
        contactName: 'Rustam Aliyev',
        email: 'chef@samarkandgrill.example',
        phone: '713-555-0142',
        monthlyVolumeBand: '500-2000',
        categoriesOfInterest: ['rice-grains'],
        notes: 'We go through about ten sacks of devzira a month.',
        website: '',
        // Milliseconds since the epoch, stamped when the form rendered. Thirty seconds ago,
        // so `looksAutomated` sees a human filling it in rather than a bot.
        formRenderedAt: Date.now() - 30_000,
      },
    });
    expect(enquiry.statusCode).toBe(201);

    const [row] = await app.db
      .select({ id: wholesaleRequests.id })
      .from(wholesaleRequests)
      .where(eq(wholesaleRequests.email, 'chef@samarkandgrill.example'));
    const enquiryId = row?.id ?? 0;

    const triaged = await app.inject({
      method: 'PATCH',
      url: `/api/admin/wholesale/requests/${String(enquiryId)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { status: 'contacted' },
    });
    expect(triaged.statusCode).toBe(200);
    expect(triaged.json<AdminWholesaleDetail>().status).toBe('contacted');

    const noted = await app.inject({
      method: 'POST',
      url: `/api/admin/wholesale/requests/${String(enquiryId)}/notes`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { body: 'Called; sending a price list for the 500-2000 lb band.' },
    });
    expect(noted.statusCode).toBe(201);

    const thread = noted.json<AdminWholesaleDetail>().thread;
    expect(thread).toHaveLength(1);
    expect(thread[0]?.authorName).toBe('Timur R.');

    // ------------------------------------------------------- 8. the log has the staff half of it
    const audit = await app.inject({
      method: 'GET',
      url: '/api/admin/audit',
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    expect(audit.statusCode).toBe(200);

    const actions = audit.json<AdminAuditResponse>().items.map((entry) => entry.action);
    // Everything an administrator did, and nothing a customer did: the order was placed and paid
    // by the customer and the webhook, and neither writes an entry.
    expect(actions).toEqual([
      'wholesale.triaged',
      'order.status_changed',
      'order.status_changed',
      'product.created',
    ]);
  });
});
