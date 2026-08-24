import {
  type BusinessType,
  Money,
  type OrderStatus,
  type VolumeBand,
  type WholesaleStatus,
} from '@silkgrain/contracts';
import { eq, sql } from 'drizzle-orm';

import { loadDotEnv } from '../../config/dotenv';
import { loadEnv } from '../../env';
import { isMain } from '../../lib/is-main';
import { hashPassword } from '../../lib/password';
import { createDatabase, type Database } from '../client';
import { redact } from '../migrate';
import {
  addresses,
  adminUsers,
  categories,
  contactMessages,
  customers,
  faqs,
  inventoryMovements,
  newsletterSubscribers,
  orderItems,
  orders,
  payments,
  productBadges,
  productCertifications,
  productImages,
  productNutrition,
  productVariants,
  products,
  promoCodes,
  promoRedemptions,
  recipeProducts,
  recipes,
  reviews,
  settings,
  shippingRates,
  wholesaleRequestNotes,
  wholesaleRequests,
} from '../schema';

import { loadDesignCatalog, type DesignProduct } from './catalog-data';
import { EXTRA_PRODUCTS, type SeedProduct } from './data/extra-products';
import {
  FAQ_CATEGORY_BY_INDEX,
  NUTRITION_BY_CATEGORY,
  RECIPE_BODIES,
  REVIEW_POOL,
} from './data/reference';
import {
  emailFromName,
  makeSku,
  mulberry32,
  originCode,
  parseDesignDate,
  parseWeightLabel,
  pickInt,
  slugify,
} from './helpers';

/**
 * Fills an empty database with the catalogue, the editorial content and enough demo commerce
 * for the admin panel to have something to show.
 *
 * Everything is deterministic: the same seed run twice produces the same rows, including
 * stock levels and which reviews landed where. Anything that would otherwise be random comes
 * out of `mulberry32` with a fixed starting value.
 *
 * The script refuses to run against a database that already has products, so it cannot
 * silently double a catalogue. Use `pnpm db:reset` first.
 */

const SEED = 20_260_729;
const TAX_BASIS_POINTS = 825; // Texas state plus Houston local, the .env default.

/** Default password for every seeded account. Local development only, never a real secret. */
const DEV_PASSWORD = 'SilkGrainDev!2026';

/** Products the mockup does not mark down; a few are put on sale so the Sale badge has data. */
const ON_SALE: Record<string, number> = {
  'chungara-red-rice': 1200,
  'dried-black-plums': 900,
  'sumac-ground': 1500,
};

interface DemoOrderLine {
  slug: string;
  weight: string;
  qty: number;
}

/**
 * Line items for the seven orders in the mockup's admin table.
 *
 * The mockup gives an order number, a customer, a date, an item count and a total. The lines
 * are composed here to match the item count; the money is then recomputed from the real
 * variant prices rather than copied from the mockup's total string, because a demo order whose
 * lines do not add up to its total is precisely the bug this codebase is built to prevent.
 */
const DEMO_ORDER_LINES: Record<string, DemoOrderLine[]> = {
  'SG-2025-08412': [
    { slug: 'uzbek-devzira-rice', weight: '5 lb', qty: 1 },
    { slug: 'dried-apricots-kuraga', weight: '1 lb', qty: 1 },
    { slug: 'plov-spice-mix', weight: '4 oz', qty: 1 },
  ],
  'SG-2025-08411': [
    { slug: 'chungara-red-rice', weight: '2 lb', qty: 1 },
    { slug: 'zira-cumin-seeds', weight: '8 oz', qty: 1 },
  ],
  'SG-2025-08410': [
    { slug: 'uzbek-devzira-rice', weight: '10 lb', qty: 2 },
    { slug: 'green-mung-beans', weight: '5 lb', qty: 2 },
    { slug: 'yellow-chickpeas-nohat', weight: '5 lb', qty: 2 },
    { slug: 'lazer-white-rice', weight: '10 lb', qty: 2 },
  ],
  'SG-2025-08409': [{ slug: 'saffron-threads', weight: '1 g', qty: 1 }],
  'SG-2025-08408': [
    { slug: 'golden-raisins-kishmish', weight: '2 lb', qty: 2 },
    { slug: 'dried-black-plums', weight: '2 lb', qty: 1 },
    { slug: 'sumac-ground', weight: '8 oz', qty: 1 },
  ],
  'SG-2025-08407': [
    { slug: 'samarkand-bulgur', weight: '5 lb', qty: 2 },
    { slug: 'red-split-lentils', weight: '5 lb', qty: 2 },
    { slug: 'dried-figs-anjir', weight: '1 lb', qty: 2 },
  ],
  'SG-2025-08406': [
    { slug: 'sesame-seeds', weight: '1 lb', qty: 1 },
    { slug: 'wheat-flour-oliy', weight: '5 lb', qty: 1 },
  ],
};

const ORDER_STATUS_BY_LABEL: Record<string, OrderStatus> = {
  Pending: 'pending',
  Paid: 'paid',
  Processing: 'processing',
  Shipped: 'shipped',
  Delivered: 'delivered',
  Cancelled: 'cancelled',
  Refunded: 'refunded',
};

const BUSINESS_TYPE_BY_LABEL: Record<string, BusinessType> = {
  Restaurant: 'restaurant',
  Grocery: 'grocery',
  Distributor: 'distributor',
  'Meal Kit': 'meal_kit',
  Other: 'other',
};

const WHOLESALE_STATUS_BY_LABEL: Record<string, WholesaleStatus> = {
  New: 'new',
  Contacted: 'contacted',
  Quoted: 'quoted',
  Converted: 'converted',
  Declined: 'declined',
};

/** `200 lbs/mo`, `2,000 lbs/mo` in the mockup, mapped onto the form's four bands. */
function volumeBand(label: string): VolumeBand {
  const pounds = Number(label.replace(/[^0-9]/g, ''));
  if (pounds < 200) return '50-200';
  if (pounds < 500) return '200-500';
  if (pounds < 2000) return '500-2000';
  return '2000+';
}

const ADDRESSES = [
  { line1: '4218 Bissonnet St', city: 'Houston', state: 'TX', zip: '77401' },
  { line1: '910 W 24th St', city: 'Austin', state: 'TX', zip: '78705' },
  { line1: '1500 Jackson St, Apt 12', city: 'Dallas', state: 'TX', zip: '75201' },
  { line1: '77 Bleecker St', city: 'New York', state: 'NY', zip: '10012' },
  { line1: '3300 NE 33rd Ave', city: 'Portland', state: 'OR', zip: '97212' },
  { line1: '2201 N Halsted St', city: 'Chicago', state: 'IL', zip: '60614' },
  { line1: '640 Valencia St', city: 'San Francisco', state: 'CA', zip: '94110' },
];

interface VariantRef {
  id: number;
  productId: number;
  productSlug: string;
  name: string;
  sku: string;
  weightLabel: string;
  priceCents: number;
  imageUrl: string | null;
}

export async function seed(db: Database, nodeEnv?: string): Promise<void> {
  // The emptiness check below is the wrong guard for the dangerous case, because a fresh
  // production database is empty - that is what "fresh" means. Seeding one would create
  // `owner@silkgrain.local` holding `DEV_PASSWORD`, which is four lines up in a file anybody can
  // read, and hand the whole back office to the first person who tries it.
  if (nodeEnv === 'production') {
    throw new Error(
      'Refusing to seed a production database. This is demo data, and it includes admin accounts ' +
        'whose password is published in this repository.',
    );
  }

  const existing = await db.select({ count: sql<number>`count(*)` }).from(products);
  if ((existing[0]?.count ?? 0) > 0) {
    throw new Error(
      'The database already has products. Run `pnpm db:reset` first - the seed never merges.',
    );
  }

  const design = loadDesignCatalog();
  const random = mulberry32(SEED);
  const passwordHash = await hashPassword(DEV_PASSWORD);

  // ------------------------------------------------------------------ categories
  const categoryIdByKey = new Map<string, number>();
  for (const [index, category] of design.categories.entries()) {
    const [row] = await db
      .insert(categories)
      .values({
        slug: category.key,
        name: category.label,
        icon: category.icon.replace(/^ph-/, ''),
        position: index,
        isActive: true,
        metaTitle: `${category.label} | SilkGrain`,
        metaDescription: `Shop ${category.label.toLowerCase()} imported directly from Central Asian family farms.`,
      })
      .$returningId();
    if (!row) throw new Error(`Category ${category.key} was not inserted`);
    categoryIdByKey.set(category.key, row.id);
  }

  // -------------------------------------------------------------------- products
  const designProducts: (DesignProduct | SeedProduct)[] = [...design.products, ...EXTRA_PRODUCTS];
  const variantsBySlugAndWeight = new Map<string, VariantRef>();
  const productIdBySlug = new Map<string, number>();

  for (const [index, product] of designProducts.entries()) {
    const categoryId = categoryIdByKey.get(product.catKey);
    if (categoryId === undefined) throw new Error(`Unknown category "${product.catKey}"`);

    const [productRow] = await db
      .insert(products)
      .values({
        slug: product.slug,
        name: product.name,
        blurb: product.blurb,
        description: product.desc,
        story: product.region === 'Central Asia' ? null : `Sourced from ${product.region}.`,
        categoryId,
        origin: originCode(product.origin),
        originRegion: product.region,
        status: 'active',
        isFeatured: product.badges.includes('Bestseller'),
        tone: product.tone,
        icon: product.icon.replace(/^ph-/, ''),
        metaTitle: `${product.name} | SilkGrain`,
        metaDescription: product.blurb,
        publishedAt: new Date('2026-01-15T00:00:00Z'),
      })
      .$returningId();
    if (!productRow) throw new Error(`Product ${product.slug} was not inserted`);
    productIdBySlug.set(product.slug, productRow.id);

    // ------------------------------------------------------------------ variants
    const stockRange: [number, number] =
      product.stock === 'out' ? [0, 0] : product.stock === 'low' ? [2, 7] : [60, 220];

    for (const [variantIndex, weight] of product.weights.entries()) {
      const parsed = parseWeightLabel(weight.label);
      const priceCents = Money.fromAmount(weight.price).cents;
      const markdown = ON_SALE[product.slug];

      const [variantRow] = await db
        .insert(productVariants)
        .values({
          productId: productRow.id,
          sku: makeSku(index, weight.label),
          weightValueMilli: parsed.valueMilli,
          weightUnit: parsed.unit,
          weightLabel: parsed.label,
          weightGrams: parsed.grams,
          priceCents,
          compareAtPriceCents: markdown === undefined ? null : priceCents + markdown,
          costCents: Math.round(priceCents * 0.58),
          stockQty: pickInt(random, stockRange[0], stockRange[1]),
          lowStockThreshold: 10,
          position: variantIndex,
          isDefault: weight.label === product.defWeight,
          isActive: true,
        })
        .$returningId();
      if (!variantRow) throw new Error(`Variant ${product.slug}/${weight.label} was not inserted`);

      variantsBySlugAndWeight.set(`${product.slug}::${weight.label}`, {
        id: variantRow.id,
        productId: productRow.id,
        productSlug: product.slug,
        name: product.name,
        sku: makeSku(index, weight.label),
        weightLabel: parsed.label,
        priceCents,
        imageUrl: product.imageUrl,
      });
    }

    // -------------------------------------------------------------------- images
    if (product.imageUrl) {
      await db.insert(productImages).values({
        productId: productRow.id,
        url: product.imageUrl,
        alt: `${product.name} - ${product.blurb}`,
        position: 0,
        isPrimary: true,
      });
    }

    // ------------------------------------------------- badges and certifications
    const editorialBadges = product.badges
      .map((badge) => badge.toLowerCase())
      .filter((badge): badge is 'bestseller' | 'new' | 'premium' =>
        ['bestseller', 'new', 'premium'].includes(badge),
      );
    if (editorialBadges.length > 0) {
      await db
        .insert(productBadges)
        .values(editorialBadges.map((badge) => ({ productId: productRow.id, badge })));
    }
    if (product.badges.includes('Organic')) {
      await db
        .insert(productCertifications)
        .values({ productId: productRow.id, certification: 'organic' });
    }

    // ----------------------------------------------------------------- nutrition
    const nutrition = NUTRITION_BY_CATEGORY[product.catKey];
    if (!nutrition) throw new Error(`No nutrition profile for category "${product.catKey}"`);
    await db.insert(productNutrition).values({
      productId: productRow.id,
      servingSize: nutrition.servingSize,
      servingsPerContainer: nutrition.servingsPerContainer,
      calories: nutrition.calories,
      fatMg: nutrition.fatMg,
      satFatMg: nutrition.satFatMg,
      carbsMg: nutrition.carbsMg,
      sugarsMg: nutrition.sugarsMg,
      fiberMg: nutrition.fiberMg,
      proteinMg: nutrition.proteinMg,
      sodiumMg: nutrition.sodiumMg,
      ingredientsText: nutrition.ingredientsText,
      allergensText: nutrition.allergensText,
    });

    // ------------------------------------------------------------------- reviews
    const reviewCount = pickInt(random, 3, 7);
    const offset = pickInt(random, 0, REVIEW_POOL.length - 1);
    let ratingTotal = 0;
    for (let n = 0; n < reviewCount; n += 1) {
      const template = REVIEW_POOL[(offset + n) % REVIEW_POOL.length];
      if (!template) continue;
      ratingTotal += template.rating;
      const createdAt = new Date(
        Date.UTC(2026, pickInt(random, 0, 6), pickInt(random, 1, 28), 12, 0, 0),
      );
      await db.insert(reviews).values({
        productId: productRow.id,
        authorName: template.authorName,
        rating: template.rating,
        title: template.title,
        body: template.body,
        status: 'published',
        isVerifiedPurchase: true,
        publishedAt: createdAt,
        createdAt,
      });
    }
    await db
      .update(products)
      .set({ ratingTotal, reviewCount, soldCount: pickInt(random, 0, 400) })
      .where(eq(products.id, productRow.id));
  }

  // -------------------------------------------------------------- shipping rates
  // Decision D-2: these are seed values; the admin panel owns them from here on.
  await db.insert(shippingRates).values([
    {
      code: 'standard',
      name: 'Standard Shipping',
      description: 'Delivered in 3-5 business days.',
      priceCents: 799,
      freeAboveCents: 7500,
      estimatedDaysMin: 3,
      estimatedDaysMax: 5,
      position: 0,
    },
    {
      code: 'express',
      name: 'Express Shipping',
      description: 'Delivered in 2-3 business days.',
      priceCents: 1299,
      freeAboveCents: null,
      estimatedDaysMin: 2,
      estimatedDaysMax: 3,
      position: 1,
    },
    {
      code: 'overnight',
      name: 'Overnight',
      description: 'Ordered before 2pm CT, delivered next business day.',
      priceCents: 2499,
      freeAboveCents: null,
      estimatedDaysMin: 1,
      estimatedDaysMax: 1,
      position: 2,
    },
  ]);

  // ----------------------------------------------------------------- promo codes
  const [welcomeCode] = await db
    .insert(promoCodes)
    .values({
      code: 'WELCOME10',
      description: '10% off a first order.',
      type: 'percent',
      value: 1000, // basis points
      minOrderCents: 3000,
      maxDiscountCents: 5000,
      usageLimit: null,
      usageLimitPerCustomer: 1,
      startsAt: new Date('2026-01-01T00:00:00Z'),
      endsAt: null,
      isActive: true,
    })
    .$returningId();
  if (!welcomeCode) throw new Error('WELCOME10 was not inserted');

  // ---------------------------------------------------------------- admin users
  await db.insert(adminUsers).values([
    { email: 'owner@silkgrain.local', passwordHash, name: 'Timur Rozmetov', role: 'owner' },
    { email: 'manager@silkgrain.local', passwordHash, name: 'Alina Petrova', role: 'manager' },
    { email: 'support@silkgrain.local', passwordHash, name: 'Ben Carter', role: 'support' },
  ]);
  const [ownerRow] = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(eq(adminUsers.email, 'owner@silkgrain.local'));

  // ------------------------------------------------------------------- customers
  const customerIdByName = new Map<string, number>();
  for (const order of design.demoOrders) {
    if (customerIdByName.has(order.cust)) continue;
    const [firstName = 'Guest', ...rest] = order.cust.split(' ');
    const [row] = await db
      .insert(customers)
      .values({
        email: emailFromName(order.cust),
        passwordHash,
        firstName,
        lastName: rest.join(' ') || 'Customer',
        marketingOptIn: random() > 0.5,
        emailVerifiedAt: new Date('2026-02-01T00:00:00Z'),
        status: 'active',
      })
      .$returningId();
    if (!row) throw new Error(`Customer ${order.cust} was not inserted`);
    customerIdByName.set(order.cust, row.id);
  }

  // ---------------------------------------------------------------- demo orders
  for (const [index, demo] of design.demoOrders.entries()) {
    const lines = DEMO_ORDER_LINES[demo.no];
    if (!lines) throw new Error(`No line items composed for order ${demo.no}`);

    const status = ORDER_STATUS_BY_LABEL[demo.status];
    if (!status) throw new Error(`Unknown order status "${demo.status}"`);

    const resolved = lines.map((line) => {
      const variant = variantsBySlugAndWeight.get(`${line.slug}::${line.weight}`);
      if (!variant) throw new Error(`No variant for ${line.slug} ${line.weight}`);
      return {
        ...line,
        variant,
        lineTotal: Money.fromCents(variant.priceCents).multiply(line.qty),
      };
    });

    const subtotal = Money.sum(resolved.map((line) => line.lineTotal));
    // One order carries the promo code, so the admin screen and the redemption table have a
    // real example rather than a table nothing ever wrote to.
    const usesPromo = demo.no === 'SG-2025-08407';
    const discount = usesPromo ? subtotal.basisPoints(1000) : Money.zero();
    const shippingMethod = index === 3 ? 'overnight' : index === 1 ? 'express' : 'standard';
    const shippingBase =
      shippingMethod === 'overnight' ? 2499 : shippingMethod === 'express' ? 1299 : 799;
    const shipping =
      shippingMethod === 'standard' && subtotal.subtract(discount).cents >= 7500
        ? Money.zero()
        : Money.fromCents(shippingBase);
    // Texas taxes shipping, so the base includes it.
    const taxable = subtotal.subtract(discount).add(shipping);
    const tax = taxable.basisPoints(TAX_BASIS_POINTS);
    const total = taxable.add(tax);

    const createdAt = parseDesignDate(demo.date);
    const paid = status !== 'pending' && status !== 'cancelled';

    const [orderRow] = await db
      .insert(orders)
      .values({
        orderNumber: demo.no,
        email: emailFromName(demo.cust),
        customerId: customerIdByName.get(demo.cust) ?? null,
        status,
        subtotalCents: subtotal.cents,
        discountCents: discount.cents,
        shippingCents: shipping.cents,
        taxCents: tax.cents,
        totalCents: total.cents,
        promoCode: usesPromo ? 'WELCOME10' : null,
        promoDiscountCents: discount.cents,
        shippingMethod,
        carrier: status === 'shipped' || status === 'delivered' ? 'UPS' : null,
        trackingNumber:
          status === 'shipped' || status === 'delivered'
            ? `1Z999AA1${String(10_000_000 + index)}`
            : null,
        createdAt,
        paidAt: paid ? createdAt : null,
        shippedAt: status === 'shipped' || status === 'delivered' ? createdAt : null,
        deliveredAt: status === 'delivered' ? createdAt : null,
        cancelledAt: status === 'cancelled' ? createdAt : null,
      })
      .$returningId();
    if (!orderRow) throw new Error(`Order ${demo.no} was not inserted`);

    // The discount is allocated across the lines so the lines still sum to the order total.
    const shares = discount.isZero()
      ? resolved.map(() => Money.zero())
      : discount.allocate(resolved.map((line) => line.lineTotal.cents));

    for (const [lineIndex, line] of resolved.entries()) {
      await db.insert(orderItems).values({
        orderId: orderRow.id,
        productId: line.variant.productId,
        variantId: line.variant.id,
        productSlug: line.variant.productSlug,
        name: line.variant.name,
        sku: line.variant.sku,
        weightLabel: line.variant.weightLabel,
        imageUrl: line.variant.imageUrl,
        unitPriceCents: line.variant.priceCents,
        qty: line.qty,
        lineTotalCents: line.lineTotal.cents,
        lineDiscountCents: shares[lineIndex]?.cents ?? 0,
        createdAt,
      });

      if (paid) {
        // The ledger and the balance are written together, which is the invariant the
        // checkout transaction will have to preserve in Phase 4.
        await db.insert(inventoryMovements).values({
          variantId: line.variant.id,
          delta: -line.qty,
          reason: 'order',
          referenceId: orderRow.id,
          note: `Order ${demo.no}`,
          createdAt,
        });
        await db
          .update(productVariants)
          .set({ stockQty: sql`GREATEST(${productVariants.stockQty} - ${line.qty}, 0)` })
          .where(eq(productVariants.id, line.variant.id));
      }
    }

    const address = ADDRESSES[index % ADDRESSES.length];
    if (!address) throw new Error('Address fixture missing');
    const [firstName = 'Guest', ...rest] = demo.cust.split(' ');
    for (const type of ['shipping', 'billing'] as const) {
      await db.insert(addresses).values({
        orderId: orderRow.id,
        type,
        firstName,
        lastName: rest.join(' ') || 'Customer',
        line1: address.line1,
        city: address.city,
        state: address.state,
        zip: address.zip,
        country: 'US',
        createdAt,
      });
    }

    await db.insert(payments).values({
      orderId: orderRow.id,
      provider: index % 3 === 2 ? 'paypal' : 'stripe',
      providerPaymentId: `seed_${demo.no.toLowerCase().replace(/-/g, '_')}`,
      status: paid ? 'succeeded' : status === 'cancelled' ? 'cancelled' : 'requires_payment',
      amountCents: total.cents,
      cardBrand: index % 3 === 2 ? null : 'Visa',
      cardLast4: index % 3 === 2 ? null : '4242',
      createdAt,
    });

    if (usesPromo) {
      await db.insert(promoRedemptions).values({
        promoCodeId: welcomeCode.id,
        orderId: orderRow.id,
        customerId: customerIdByName.get(demo.cust) ?? null,
        email: emailFromName(demo.cust),
        discountCents: discount.cents,
        createdAt,
      });
      await db
        .update(promoCodes)
        .set({ usedCount: sql`${promoCodes.usedCount} + 1` })
        .where(eq(promoCodes.id, welcomeCode.id));
    }
  }

  // ----------------------------------------------------------- wholesale enquiries
  for (const request of design.wholesaleRequests) {
    const businessType = BUSINESS_TYPE_BY_LABEL[request.type];
    const status = WHOLESALE_STATUS_BY_LABEL[request.status];
    if (!businessType || !status) {
      throw new Error(`Unknown wholesale type/status: ${request.type} / ${request.status}`);
    }

    const [row] = await db
      .insert(wholesaleRequests)
      .values({
        businessName: request.biz,
        businessType,
        contactFirstName: request.biz.split(' ')[0] ?? request.biz,
        contactLastName: null,
        email: `orders@${slugify(request.biz)}.example.com`,
        phone: '+1 713 555 0140',
        categoriesOfInterest: request.prod.split(',').map((entry) => slugify(entry.trim())),
        monthlyVolumeBand: volumeBand(request.vol),
        notes: `Submitted through the wholesale form. Interested in ${request.prod.toLowerCase()}.`,
        status,
        assignedToId: status === 'new' ? null : (ownerRow?.id ?? null),
        createdAt: parseDesignDate(request.date),
      })
      .$returningId();
    if (!row) throw new Error(`Wholesale request for ${request.biz} was not inserted`);

    if (status !== 'new' && ownerRow) {
      await db.insert(wholesaleRequestNotes).values({
        requestId: row.id,
        adminUserId: ownerRow.id,
        authorName: 'Timur Rozmetov',
        body:
          status === 'declined'
            ? 'Volume is below our 50 lb minimum for a standing account. Referred to retail.'
            : 'Called and sent the current wholesale price list. Following up next week.',
        createdAt: parseDesignDate(request.date),
      });
    }
  }

  // --------------------------------------------------------------------- recipes
  for (const recipe of design.recipes) {
    const slug = slugify(recipe.title);
    const content = RECIPE_BODIES[slug];
    if (!content) throw new Error(`No body written for recipe "${recipe.title}" (${slug})`);

    const [row] = await db
      .insert(recipes)
      .values({
        slug,
        title: recipe.title,
        excerpt: recipe.blurb,
        heroImageUrl: recipe.img,
        heroImageAlt: recipe.title,
        body: content.body,
        prepMinutes: content.prepMinutes,
        cookMinutes: content.cookMinutes,
        servings: content.servings,
        difficulty:
          recipe.level === 'Easy' ? 'easy' : recipe.level === 'Advanced' ? 'hard' : 'medium',
        isPublished: true,
        publishedAt: new Date('2026-03-01T00:00:00Z'),
        metaTitle: `${recipe.title} | SilkGrain Recipes`,
        metaDescription: recipe.blurb,
      })
      .$returningId();
    if (!row) throw new Error(`Recipe ${slug} was not inserted`);

    for (const [position, productSlug] of content.products.entries()) {
      const productId = productIdBySlug.get(productSlug);
      if (productId === undefined) {
        throw new Error(`Recipe ${slug} refers to unknown product "${productSlug}"`);
      }
      await db.insert(recipeProducts).values({ recipeId: row.id, productId, position });
    }
  }

  // ------------------------------------------------------------------------ FAQ
  await db.insert(faqs).values(
    design.faqs.map((faq, index) => ({
      category: FAQ_CATEGORY_BY_INDEX[index] ?? 'ordering',
      question: faq.q,
      answer: faq.a,
      position: index,
      isPublished: true,
    })),
  );

  // ------------------------------------------------------------------- settings
  await db.insert(settings).values([
    {
      key: 'store.name',
      value: 'SilkGrain',
      group: 'general',
      label: 'Store name',
      isPublic: true,
    },
    {
      key: 'store.contact_email',
      value: 'hello@silkgrain.com',
      group: 'general',
      label: 'Public contact address',
      isPublic: true,
    },
    {
      key: 'store.address',
      value: '5850 San Felipe St, Houston, TX 77057',
      group: 'general',
      label: 'Warehouse address',
      isPublic: true,
    },
    // `commerce.free_shipping_threshold_cents` used to be here and is deliberately gone. Decision
    // D-22 makes `shipping_rates.free_above_cents` the authority - the checkout charges from it -
    // and the storefront now reads the figure from `GET /api/settings`, which computes it from the
    // rates. A second copy of the number was a second thing to forget to change.
    {
      key: 'commerce.default_tax_basis_points',
      value: TAX_BASIS_POINTS,
      group: 'commerce',
      label: 'Estimated tax rate, basis points',
      description:
        'Shown in the cart as "Estimated Tax" (decision D-4). Stripe Tax is authoritative once ' +
        'the address is known at checkout.',
      isPublic: true,
    },
    {
      key: 'announcement.text',
      value: 'Complimentary shipping over $75 - Direct from family farms',
      group: 'content',
      label: 'Announcement bar',
      isPublic: true,
    },
    {
      key: 'ops.notification_email',
      value: 'ops@silkgrain.com',
      group: 'operations',
      label: 'Wholesale and low-stock alerts',
      isPublic: false,
    },
  ]);

  // -------------------------------------------------- newsletter and contact form
  await db.insert(newsletterSubscribers).values(
    [
      'nurbek.tashkent@example.com',
      'elena.morrison@example.com',
      'chef@bazaarbistro.example.com',
    ].map((email, index) => ({
      email,
      status: 'subscribed' as const,
      source: index === 0 ? 'footer' : 'checkout',
      unsubscribeToken: `seed-unsubscribe-${String(index + 1).padStart(4, '0')}`,
      confirmedAt: new Date('2026-04-0' + String(index + 1) + 'T00:00:00Z'),
    })),
  );

  await db.insert(contactMessages).values([
    {
      name: 'Peter Nowak',
      email: 'peter.nowak@example.com',
      subject: 'Bulk order for a supper club',
      body: 'We run a monthly supper club for about forty people. Is there a price break below the 50 lb wholesale minimum?',
      status: 'new',
    },
    {
      name: 'Dilnoza Yusupova',
      email: 'dilnoza.y@example.com',
      subject: 'Devzira restock',
      body: 'The 25 lb Devzira has been out for two weeks. Any idea when the next container lands?',
      orderNumber: 'SG-2025-08410',
      status: 'answered',
      answeredAt: new Date('2026-07-02T09:30:00Z'),
    },
  ]);
}

if (isMain(import.meta.url)) {
  loadDotEnv();
  const env = loadEnv();
  const handle = createDatabase(env.DATABASE_URL, env.DATABASE_POOL_SIZE);
  try {
    await seed(handle.db, env.NODE_ENV);
    process.stdout.write(
      `seeded ${redact(env.DATABASE_URL)}\n` +
        `admin login: owner@silkgrain.local / ${DEV_PASSWORD} (development only)\n`,
    );
  } finally {
    await handle.close();
  }
}
