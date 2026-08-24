import { eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import {
  categories,
  customers,
  orders,
  productBadges,
  productCertifications,
  productImages,
  productNutrition,
  productVariants,
  products,
  promoCodes,
  promoRedemptions,
  reviews,
  settings,
  shippingRates,
} from '../../db/schema';
import { hashPassword } from '../../lib/password';

/**
 * A catalogue small enough to hold in your head.
 *
 * The seed builds thirty-two products with pseudo-random ratings and stock, which is right for
 * looking at the storefront and wrong for asserting against: "the third result is Chungara"
 * would be a fact about a random number generator. Everything here is stated explicitly, and
 * the expected orderings are written out beside the data that produces them.
 *
 * Seven products, of which five are ever visible - the other two exist to prove that a draft
 * and a product whose last variant was retired both stay out of every listing.
 */

export const FIXTURE_PASSWORD = 'Silk-Grain-2026';

/** Everything a test needs to address a row, keyed the way the tests read. */
export interface CatalogFixture {
  categoryIds: Record<CategorySlug, number>;
  productIds: Record<ProductSlug, number>;
  variants: {
    devzira2lb: number;
    devzira5lbLow: number;
    devzira10lbOut: number;
    chungara5lb: number;
    redLentils1lb: number;
    greenLentils1lbOut: number;
    saffron8oz: number;
    /** Belongs to an active product but is switched off: the "no longer available" case. */
    retiredVariant: number;
    /** Active and in stock, but its product is a draft. Must be unreachable everywhere. */
    draftVariant: number;
  };
  /** Has already redeemed WELCOME10, so the per-customer limit rejects a second attempt. */
  returningCustomer: { id: number; email: string };
}

type CategorySlug = 'rice' | 'long-grain-rice' | 'lentils' | 'spices' | 'dried-fruit';
type ProductSlug =
  | 'devzira-rice'
  | 'chungara-rice'
  | 'red-lentils'
  | 'green-lentils'
  | 'samarkand-saffron'
  | 'hidden-draft'
  | 'retired-product';

const DAY = 86_400_000;

export async function seedCatalogFixture(db: Database): Promise<CatalogFixture> {
  const now = Date.now();

  // ------------------------------------------------------------------- categories
  const categoryIds = {} as Record<CategorySlug, number>;
  const insertCategory = async (
    slug: CategorySlug,
    name: string,
    position: number,
    parent: CategorySlug | null,
  ) => {
    const [row] = await db
      .insert(categories)
      .values({
        slug,
        name,
        description: `${name} from Central Asia`,
        icon: 'bowl-food',
        position,
        parentId: parent === null ? null : categoryIds[parent],
        isActive: true,
      })
      .$returningId();
    if (!row) throw new Error(`fixture: category ${slug} was not inserted`);
    categoryIds[slug] = row.id;
  };

  await insertCategory('rice', 'Rice & Grains', 0, null);
  await insertCategory('long-grain-rice', 'Long-Grain Rice', 0, 'rice');
  await insertCategory('lentils', 'Lentils & Legumes', 1, null);
  await insertCategory('spices', 'Spices', 2, null);
  // No products at all: proves the counts are computed rather than copied from the mockup.
  await insertCategory('dried-fruit', 'Dried Fruit', 3, null);

  // --------------------------------------------------------------------- products
  const productIds = {} as Record<ProductSlug, number>;
  const insertProduct = async (spec: {
    slug: ProductSlug;
    name: string;
    category: CategorySlug;
    origin: 'UZ' | 'KZ' | 'TJ' | 'KG';
    status?: 'active' | 'draft';
    isFeatured?: boolean;
    soldCount: number;
    publishedDaysAgo: number;
    ratingTotal?: number;
    reviewCount?: number;
    /**
     * A word that appears in the blurb and nowhere in any name or category.
     *
     * Search covers name, subtitle, blurb and category name. Deriving all four from the name -
     * which is the obvious way to write a fixture - would make a search that only ever looked
     * at the name indistinguishable from one that looked at all four.
     */
    blurbTerm?: string;
    subtitleTerm?: string;
  }) => {
    const [row] = await db
      .insert(products)
      .values({
        slug: spec.slug,
        name: spec.name,
        subtitle: spec.subtitleTerm ?? `${spec.name} subtitle`,
        blurb: `${spec.name}, ${spec.blurbTerm ?? 'sourced'} direct from the growers.`,
        description: `# ${spec.name}\n\nLong-form copy for ${spec.name}.`,
        story: `The story behind ${spec.name}.`,
        categoryId: categoryIds[spec.category],
        origin: spec.origin,
        originRegion: 'Fergana Valley',
        status: spec.status ?? 'active',
        isFeatured: spec.isFeatured ?? false,
        tone: 'linear-gradient(135deg,#F1E9DA,#FCFAF4)',
        icon: 'grains',
        ratingTotal: spec.ratingTotal ?? 0,
        reviewCount: spec.reviewCount ?? 0,
        soldCount: spec.soldCount,
        metaTitle: `${spec.name} | SilkGrain`,
        metaDescription: `Buy ${spec.name}.`,
        publishedAt: new Date(now - spec.publishedDaysAgo * DAY),
      })
      .$returningId();
    if (!row) throw new Error(`fixture: product ${spec.slug} was not inserted`);
    productIds[spec.slug] = row.id;
    return row.id;
  };

  // Reviews below give this one 14 points across 3 published reviews: an average of 4.7.
  await insertProduct({
    slug: 'devzira-rice',
    name: 'Devzira Red Rice',
    category: 'rice',
    origin: 'UZ',
    isFeatured: true,
    soldCount: 500,
    publishedDaysAgo: 200,
    ratingTotal: 14,
    reviewCount: 3,
    blurbTerm: 'heirloom',
    subtitleTerm: 'Fergana terraces',
  });
  await insertProduct({
    slug: 'chungara-rice',
    name: 'Chungara White Rice',
    category: 'long-grain-rice',
    origin: 'KZ',
    soldCount: 300,
    publishedDaysAgo: 160,
  });
  await insertProduct({
    slug: 'red-lentils',
    name: 'Red Split Lentils',
    category: 'lentils',
    origin: 'TJ',
    soldCount: 100,
    publishedDaysAgo: 120,
  });
  await insertProduct({
    slug: 'green-lentils',
    name: 'Green Lentils',
    category: 'lentils',
    origin: 'KG',
    soldCount: 50,
    publishedDaysAgo: 80,
  });
  await insertProduct({
    slug: 'samarkand-saffron',
    name: 'Samarkand Saffron',
    category: 'spices',
    origin: 'UZ',
    soldCount: 10,
    publishedDaysAgo: 40,
  });
  await insertProduct({
    slug: 'hidden-draft',
    name: 'Unreleased Barley',
    category: 'rice',
    origin: 'UZ',
    status: 'draft',
    soldCount: 9_999,
    publishedDaysAgo: 1,
  });
  await insertProduct({
    slug: 'retired-product',
    name: 'Discontinued Cumin',
    category: 'spices',
    origin: 'UZ',
    soldCount: 8_888,
    publishedDaysAgo: 2,
  });

  // --------------------------------------------------------------------- variants
  const insertVariant = async (spec: {
    product: ProductSlug;
    sku: string;
    label: string;
    grams: number | null;
    priceCents: number;
    compareAtPriceCents?: number;
    stockQty: number;
    lowStockThreshold?: number;
    isDefault?: boolean;
    isActive?: boolean;
    position: number;
  }): Promise<number> => {
    const [row] = await db
      .insert(productVariants)
      .values({
        productId: productIds[spec.product],
        sku: spec.sku,
        weightValueMilli: Math.round(Number(spec.label.split(' ')[0] ?? '1') * 1000),
        weightUnit: spec.label.endsWith('oz') ? 'oz' : 'lb',
        weightLabel: spec.label,
        weightGrams: spec.grams,
        priceCents: spec.priceCents,
        compareAtPriceCents: spec.compareAtPriceCents ?? null,
        stockQty: spec.stockQty,
        lowStockThreshold: spec.lowStockThreshold ?? 10,
        position: spec.position,
        isDefault: spec.isDefault ?? false,
        isActive: spec.isActive ?? true,
      })
      .$returningId();
    if (!row) throw new Error(`fixture: variant ${spec.sku} was not inserted`);
    return row.id;
  };

  // Devzira spans all three stock states, so one product exercises every branch of the cart.
  //
  // Inserted heaviest first, deliberately. Position and insertion order would otherwise agree,
  // and a listing that sorted variants by id instead of by position would look correct.
  const devzira10lbOut = await insertVariant({
    product: 'devzira-rice',
    sku: 'SG-001-10LB',
    label: '10 lb',
    grams: 4536,
    priceCents: 4500,
    compareAtPriceCents: 5500,
    stockQty: 0,
    position: 2,
  });
  const devzira2lb = await insertVariant({
    product: 'devzira-rice',
    sku: 'SG-001-2LB',
    label: '2 lb',
    grams: 907,
    priceCents: 1200,
    stockQty: 50,
    isDefault: true,
    position: 0,
  });
  // Marked down and in stock, so a cart line can carry a struck-through price. The 10 lb is
  // also marked down but can never reach a cart, being the out-of-stock case.
  const devzira5lbLow = await insertVariant({
    product: 'devzira-rice',
    sku: 'SG-001-5LB',
    label: '5 lb',
    grams: 2268,
    priceCents: 2500,
    compareAtPriceCents: 3000,
    stockQty: 5,
    position: 1,
  });
  const chungara5lb = await insertVariant({
    product: 'chungara-rice',
    sku: 'SG-002-5LB',
    label: '5 lb',
    grams: 2268,
    priceCents: 2000,
    stockQty: 100,
    isDefault: true,
    position: 0,
  });
  const redLentils1lb = await insertVariant({
    product: 'red-lentils',
    sku: 'SG-003-1LB',
    label: '1 lb',
    grams: 454,
    priceCents: 600,
    stockQty: 30,
    isDefault: true,
    position: 0,
  });
  await insertVariant({
    product: 'red-lentils',
    sku: 'SG-003-5LB',
    label: '5 lb',
    grams: 2268,
    priceCents: 2200,
    stockQty: 20,
    position: 1,
  });
  const greenLentils1lbOut = await insertVariant({
    product: 'green-lentils',
    sku: 'SG-004-1LB',
    label: '1 lb',
    grams: 454,
    priceCents: 800,
    stockQty: 0,
    isDefault: true,
    position: 0,
  });
  const saffron8oz = await insertVariant({
    product: 'samarkand-saffron',
    sku: 'SG-005-8OZ',
    label: '8 oz',
    grams: 227,
    priceCents: 9900,
    stockQty: 12,
    lowStockThreshold: 3,
    isDefault: true,
    position: 0,
  });
  // Active and in stock, but its product is a draft. Nothing may price it.
  const draftVariant = await insertVariant({
    product: 'hidden-draft',
    sku: 'SG-006-1LB',
    label: '1 lb',
    grams: 454,
    priceCents: 1000,
    stockQty: 10,
    isDefault: true,
    position: 0,
  });
  const retiredVariant = await insertVariant({
    product: 'retired-product',
    sku: 'SG-007-1LB',
    label: '1 lb',
    grams: 454,
    priceCents: 3000,
    stockQty: 10,
    isDefault: true,
    isActive: false,
    position: 0,
  });

  // ---------------------------------------------------------- images, badges, certs
  await db.insert(productImages).values(
    (
      [
        'devzira-rice',
        'chungara-rice',
        'red-lentils',
        'green-lentils',
        'samarkand-saffron',
      ] as const
    ).map((slug, index) => ({
      productId: productIds[slug],
      url: `https://images.example.com/${slug}.jpg`,
      alt: `${slug} photograph`,
      width: 1200,
      height: 1200,
      position: index,
      isPrimary: true,
    })),
  );

  await db.insert(productBadges).values([
    { productId: productIds['devzira-rice'], badge: 'bestseller' },
    { productId: productIds['red-lentils'], badge: 'new' },
    { productId: productIds['samarkand-saffron'], badge: 'premium' },
  ]);

  await db.insert(productCertifications).values([
    { productId: productIds['devzira-rice'], certification: 'organic' },
    { productId: productIds['devzira-rice'], certification: 'non_gmo' },
    { productId: productIds['red-lentils'], certification: 'halal' },
    { productId: productIds['samarkand-saffron'], certification: 'organic' },
  ]);

  await db.insert(productNutrition).values({
    productId: productIds['devzira-rice'],
    servingSize: '1/4 cup (45 g)',
    servingsPerContainer: 20,
    calories: 160,
    fatMg: 500,
    satFatMg: 100,
    carbsMg: 35_000,
    sugarsMg: 0,
    fiberMg: 1_000,
    proteinMg: 3_000,
    sodiumMg: 0,
    ingredientsText: 'Devzira red rice.',
    allergensText: null,
  });

  // ----------------------------------------------------------------------- reviews
  // Three published, one still in moderation. The pending one must not reach the histogram,
  // the average or the count - which is the whole point of having it here.
  await db.insert(reviews).values([
    {
      productId: productIds['devzira-rice'],
      authorName: 'Aigerim S.',
      rating: 5,
      title: 'The real thing',
      // Long enough to qualify as a testimonial, and deliberately so: the home page quotes
      // five-star reviews above `TESTIMONIAL_MIN_BODY_LENGTH` characters, and a fixture whose
      // every review fell under it would let that query return nothing and still pass.
      body: 'Exactly the rice my grandmother used, and the first plov I have made in years that tasted like hers.',
      status: 'published',
      isVerifiedPurchase: true,
      publishedAt: new Date(now - 30 * DAY),
    },
    {
      productId: productIds['devzira-rice'],
      authorName: 'Marcus T.',
      rating: 4,
      title: 'Very good',
      body: 'Cooks beautifully, a little pricey.',
      status: 'published',
      isVerifiedPurchase: true,
      publishedAt: new Date(now - 20 * DAY),
    },
    {
      productId: productIds['devzira-rice'],
      authorName: 'Dilnoza R.',
      rating: 5,
      title: null,
      body: 'Plov has never been better in this house, and the grains stay separate every single time.',
      status: 'published',
      isVerifiedPurchase: false,
      publishedAt: new Date(now - 10 * DAY),
    },
    {
      productId: productIds['devzira-rice'],
      authorName: 'Spam Bot',
      rating: 1,
      title: 'buy followers',
      body: 'not a real review',
      status: 'pending',
      isVerifiedPurchase: false,
      publishedAt: null,
    },
  ]);

  // ----------------------------------------------------------- commerce configuration
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
      description: 'Next business day.',
      priceCents: 2499,
      freeAboveCents: null,
      estimatedDaysMin: 1,
      estimatedDaysMax: 1,
      position: 2,
    },
  ]);

  await db.insert(settings).values({
    key: 'commerce.default_tax_basis_points',
    value: 825,
    group: 'commerce',
    label: 'Estimated tax rate, basis points',
    isPublic: true,
  });

  // One code per rejection path, so no test has to mutate a shared row to reach its case.
  await db.insert(promoCodes).values([
    {
      code: 'WELCOME10',
      description: '10% off a first order.',
      type: 'percent',
      value: 1000,
      minOrderCents: 3000,
      maxDiscountCents: 5000,
      // A window that is open and a global limit that is nowhere near reached: without both,
      // an expiry check or a usage check that rejected unconditionally would still pass every
      // test in the suite, because nothing would ever take the accepting branch.
      usageLimit: 1000,
      usedCount: 1,
      usageLimitPerCustomer: 1,
      startsAt: new Date(now - 200 * DAY),
      endsAt: new Date(now + 200 * DAY),
      isActive: true,
    },
    { code: 'FLAT5', description: '$5 off.', type: 'fixed', value: 500, isActive: true },
    // Larger than any cart it is tested against: the discount must clamp to the subtotal
    // rather than turning the order into a payout.
    { code: 'FLAT50', description: '$50 off.', type: 'fixed', value: 5000, isActive: true },
    {
      code: 'SHIPFREE',
      description: 'Free shipping.',
      type: 'free_shipping',
      value: 0,
      isActive: true,
    },
    // 50 % but capped at $5, so the cap is what decides.
    {
      code: 'CAP5',
      description: 'Half price, up to $5.',
      type: 'percent',
      value: 5000,
      maxDiscountCents: 500,
      isActive: true,
    },
    {
      code: 'EXPIRED10',
      type: 'percent',
      value: 1000,
      startsAt: new Date(now - 60 * DAY),
      endsAt: new Date(now - DAY),
      isActive: true,
    },
    {
      code: 'FUTURE10',
      type: 'percent',
      value: 1000,
      startsAt: new Date(now + 30 * DAY),
      isActive: true,
    },
    { code: 'USEDUP', type: 'percent', value: 1000, usageLimit: 1, usedCount: 1, isActive: true },
    { code: 'SWITCHEDOFF', type: 'percent', value: 1000, isActive: false },
  ]);

  // ------------------------------------------------------- a customer with a history
  const passwordHash = await hashPassword(FIXTURE_PASSWORD);
  const email = 'returning@example.com';
  const [customerRow] = await db
    .insert(customers)
    .values({
      email,
      passwordHash,
      firstName: 'Nodira',
      lastName: 'Yusupova',
      marketingOptIn: false,
    })
    .$returningId();
  if (!customerRow) throw new Error('fixture: the returning customer was not inserted');

  const [orderRow] = await db
    .insert(orders)
    .values({
      orderNumber: 'SG-2026-00001',
      email,
      customerId: customerRow.id,
      status: 'paid',
      subtotalCents: 5000,
      discountCents: 500,
      shippingCents: 799,
      taxCents: 437,
      totalCents: 5736,
      promoCode: 'WELCOME10',
      promoDiscountCents: 500,
      shippingMethod: 'standard',
      paidAt: new Date(now - 90 * DAY),
    })
    .$returningId();
  if (!orderRow) throw new Error('fixture: the historical order was not inserted');

  const [welcome] = await db
    .select({ id: promoCodes.id })
    .from(promoCodes)
    .where(eq(promoCodes.code, 'WELCOME10'));
  if (!welcome) throw new Error('fixture: WELCOME10 was not inserted');

  await db.insert(promoRedemptions).values({
    promoCodeId: welcome.id,
    orderId: orderRow.id,
    customerId: customerRow.id,
    email,
    discountCents: 500,
  });

  return {
    categoryIds,
    productIds,
    variants: {
      devzira2lb,
      devzira5lbLow,
      devzira10lbOut,
      chungara5lb,
      redLentils1lb,
      greenLentils1lbOut,
      saffron8oz,
      retiredVariant,
      draftVariant,
    },
    returningCustomer: { id: customerRow.id, email },
  };
}
