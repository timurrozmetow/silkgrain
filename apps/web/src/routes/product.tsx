import type { ProductDetailResponse, ProductVariantView } from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import {
  Badge,
  Breadcrumb,
  Button,
  EmptyState,
  Eyebrow,
  Icon,
  QuantityStepper,
  Skeleton,
  StarRating,
  Tabs,
  isIconName,
} from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { ButtonLink } from '../components/ButtonLink';
import { NutritionPanel } from '../components/product/NutritionPanel';
import { ReviewsPanel } from '../components/product/ReviewsPanel';
import { ProductGrid } from '../components/ProductGrid';
import { apiGet } from '../lib/api';
import { breadcrumbJsonLd, Seo } from '../lib/seo';
import { useCart } from '../store/cart';

import { rootRoute } from './root';

/**
 * The product page.
 *
 * Two columns with the gallery sticky, as the mockup draws it. Everything on it comes from
 * `GET /api/products/:slug` in one request - variants, images, nutrition, certifications, the
 * review histogram and the related row - so the page has one loading state rather than six.
 *
 * "Buy Now" is not here: it goes to `/checkout`, which is Phase 6. The wholesale notice is
 * text rather than a link for the same reason. Both become what the design draws when their
 * destinations exist.
 */
function Product() {
  const { slug } = productRoute.useParams();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['product', slug],
    queryFn: ({ signal }) => apiGet<ProductDetailResponse>(`/products/${slug}`, signal),
  });

  if (isPending) return <ProductSkeleton />;

  if (isError) {
    const notFound = (error as { status?: number }).status === 404;
    return (
      <div className="mx-auto max-w-container px-gutter py-24 tablet:px-gutter-tablet mobile:px-gutter-mobile">
        <EmptyState
          icon={notFound ? 'magnifying-glass' : 'warning-circle'}
          tone={notFound ? 'green' : 'gold'}
          title={notFound ? 'We do not stock that' : 'This page could not be loaded'}
          description={
            notFound
              ? 'It may have sold out for the season, or the link may have a typo in it.'
              : 'That is on us. Refreshing usually sorts it out.'
          }
          action={<ButtonLink to="/shop">Browse the pantry</ButtonLink>}
        />
      </div>
    );
  }

  return <ProductDetail data={data} />;
}

function ProductDetail({ data }: { data: ProductDetailResponse }) {
  const { product, related } = data;
  const add = useCart((state) => state.add);

  const [variantId, setVariantId] = useState(product.defaultVariantId);
  const [qty, setQty] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [tab, setTab] = useState('description');

  const variant =
    product.variants.find((candidate) => candidate.id === variantId) ?? product.variants[0];
  if (variant === undefined) throw new Error('A product reached the page with no variants');

  const image = product.images[imageIndex] ?? product.images[0];
  const soldOut = variant.stockState === 'out';

  const tabs = [
    { id: 'description', label: 'Description' },
    ...(product.nutrition === null ? [] : [{ id: 'nutrition', label: 'Nutrition Facts' }]),
    ...(product.story === null ? [] : [{ id: 'origin', label: 'Origin & Sourcing' }]),
    { id: 'reviews', label: `Reviews (${String(product.reviews.count)})` },
  ];

  return (
    <div className="mx-auto max-w-container px-gutter py-8 tablet:px-gutter-tablet mobile:px-gutter-mobile">
      <Seo
        title={product.seo.metaTitle ?? `${product.name} — SilkGrain`}
        description={product.seo.metaDescription ?? product.blurb}
        canonicalPath={`/product/${product.slug}`}
        type="product"
        imageUrl={product.image?.url ?? null}
        jsonLd={[
          productJsonLd(product),
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Shop', path: '/shop' },
            { name: product.category.name, path: `/shop?category=${product.category.slug}` },
            { name: product.name, path: `/product/${product.slug}` },
          ]),
        ]}
      />
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Shop', href: '/shop' },
          { label: product.category.name, href: `/shop?category=${product.category.slug}` },
          { label: product.name },
        ]}
      />

      <div className="mt-8 grid grid-cols-2 gap-16 tablet:gap-10 mobile:grid-cols-1 mobile:gap-8">
        {/* Gallery. Sticky on desktop, unpinned below 1024px per the responsive handoff. */}
        <div className="sticky top-[96px] self-start tablet:static">
          <div className="flex aspect-square items-center justify-center overflow-hidden bg-gradient-to-br from-white to-gold-pale">
            {image === undefined ? (
              <Icon
                name={isIconName(product.icon) ? product.icon : 'grains'}
                size={110}
                className="text-green/20"
              />
            ) : (
              <img
                src={image.url}
                alt={image.alt}
                className="h-full w-full object-cover"
                width={image.width ?? undefined}
                height={image.height ?? undefined}
              />
            )}
          </div>

          {product.images.length > 1 && (
            <ul className="mt-4 grid grid-cols-4 gap-3">
              {product.images.slice(0, 4).map((thumb, index) => (
                <li key={thumb.url}>
                  <button
                    type="button"
                    aria-label={`View image ${String(index + 1)}`}
                    aria-current={index === imageIndex}
                    onClick={() => {
                      setImageIndex(index);
                    }}
                    className={`block aspect-square w-full overflow-hidden border-2 ${
                      index === imageIndex ? 'border-green' : 'border-transparent'
                    }`}
                  >
                    <img src={thumb.url} alt="" className="h-full w-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow>{product.category.name}</Eyebrow>
            {product.badges.map((badge) => (
              <Badge key={badge} tone={badge}>
                {BADGE_LABELS[badge]}
              </Badge>
            ))}
          </div>

          <h1 className="mt-4 font-display text-[48px] font-medium leading-[1.1] text-ink mobile:text-[32px]">
            {product.name}
          </h1>

          {product.reviews.count > 0 && (
            <div className="mt-4 flex items-center gap-3">
              <StarRating value={product.reviews.average} size="md" compact />
              <button
                type="button"
                className="text-[13px] text-green underline underline-offset-4"
                onClick={() => {
                  setTab('reviews');
                }}
              >
                {product.reviews.count} {product.reviews.count === 1 ? 'review' : 'reviews'}
              </button>
            </div>
          )}

          <p className="mt-5 max-w-[52ch] text-body text-body-muted">{product.blurb}</p>

          <hr className="my-7 border-line" />

          <fieldset>
            <legend className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              Select weight
            </legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {product.variants.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  aria-pressed={candidate.id === variant.id}
                  disabled={candidate.stockState === 'out'}
                  onClick={() => {
                    setVariantId(candidate.id);
                    setQty(1);
                  }}
                  className={`min-h-[44px] rounded-sm border px-4 font-mono text-[13px] transition-colors disabled:opacity-40 ${
                    candidate.id === variant.id
                      ? 'border-green bg-green text-white'
                      : 'border-line bg-surface text-ink hover:border-green'
                  }`}
                >
                  {candidate.weightLabel}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mt-7 flex items-end gap-4">
            <p className="font-mono text-[34px] leading-none text-ink">
              {Money.fromCents(variant.priceCents).format()}
            </p>
            {variant.compareAtPriceCents !== null && (
              <p className="font-mono text-[17px] text-muted line-through">
                {Money.fromCents(variant.compareAtPriceCents).format()}
              </p>
            )}
            <p className="text-[13px] text-muted">per {variant.weightLabel}</p>
          </div>

          <p className="mt-3 flex items-center gap-2 text-[13px]">
            <span className={`h-2 w-2 rounded-full ${STOCK_DOT[variant.stockState]}`} />
            <span className={STOCK_TEXT[variant.stockState]}>
              {variant.stockState === 'in'
                ? 'In stock, ships within 48 hours'
                : variant.stockState === 'low'
                  ? `Only ${String(variant.availableQty)} left`
                  : 'Sold out for now'}
            </span>
          </p>

          <div className="mt-7 flex items-stretch gap-4 mobile:flex-col">
            <QuantityStepper
              value={qty}
              min={1}
              max={Math.max(variant.availableQty, 1)}
              disabled={soldOut}
              label={`Quantity of ${product.name}, ${variant.weightLabel}`}
              onChange={setQty}
            />
            <Button
              size="lg"
              corner="sharp"
              className="flex-1"
              disabled={soldOut}
              onClick={() => {
                add(variant.id, qty);
              }}
            >
              {soldOut
                ? 'Sold out'
                : `Add to Cart · ${Money.fromCents(variant.priceCents * qty).format()}`}
            </Button>
          </div>

          {/* The wholesale enquiry form is Phase 6, so this is a notice rather than a CTA. */}
          <p className="mt-6 flex items-start gap-3 border border-gold bg-gold-notice px-4 py-3 text-[13px] text-ink">
            <Icon name="package" size={17} className="mt-0.5 shrink-0 text-gold-dark" />
            <span>
              Need 25&nbsp;lbs or more? We price by the pallet for restaurants and grocers.
            </span>
          </p>

          <ul className="mt-7 flex gap-7 border-t border-line pt-6 mobile:flex-wrap mobile:gap-4">
            {(
              [
                ['lock-simple', 'Secure checkout'],
                ['truck', 'Free shipping $75+'],
                ['arrow-counter-clockwise', '30-day returns'],
              ] as const
            ).map(([icon, label]) => (
              <li key={label} className="flex items-center gap-2 text-[12px] text-muted">
                <Icon name={icon} size={15} className="text-green" />
                {label}
              </li>
            ))}
          </ul>

          <p className="mt-4 flex items-center gap-2 text-[12px] text-muted">
            <Icon name="map-pin" size={14} className="text-green" />
            Ships from Houston, TX
          </p>

          {product.certifications.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2">
              {product.certifications.map((certification) => (
                <li
                  key={certification}
                  className="rounded-sm border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted"
                >
                  {CERTIFICATION_LABELS[certification]}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <section className="mt-20 mobile:mt-12">
        <Tabs items={tabs} value={tab} onChange={setTab} label="Product details">
          {tab === 'description' && (
            <div className="max-w-[70ch] whitespace-pre-line text-body text-body-muted">
              {product.description}
            </div>
          )}
          {tab === 'nutrition' && product.nutrition !== null && (
            <div className="grid grid-cols-[300px_1fr] gap-12 tablet:gap-8 mobile:grid-cols-1">
              <NutritionPanel facts={product.nutrition} />
              <div>
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                  Ingredients
                </h3>
                <p className="mt-2 text-bodySm text-body-muted">
                  {product.nutrition.ingredientsText}
                </p>
                {product.nutrition.allergensText !== null && (
                  <>
                    <h3 className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                      Allergens
                    </h3>
                    <p className="mt-2 text-bodySm text-body-muted">
                      {product.nutrition.allergensText}
                    </p>
                  </>
                )}
                <p className="mt-6 text-[12px] text-muted">
                  Reference values for this category. Per-lot figures come from the supplier&rsquo;s
                  certificate of analysis.
                </p>
              </div>
            </div>
          )}
          {tab === 'origin' && product.story !== null && (
            <div className="max-w-[70ch]">
              {product.originRegion !== null && (
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-dark">
                  {product.originRegion}
                </p>
              )}
              <div className="mt-3 whitespace-pre-line text-body text-body-muted">
                {product.story}
              </div>
            </div>
          )}
          {tab === 'reviews' && <ReviewsPanel reviews={product.reviews} />}
        </Tabs>
      </section>

      {related.length > 0 && (
        <section className="mt-20 mobile:mt-12">
          <div className="mb-8 flex items-end justify-between gap-6">
            <div>
              <Eyebrow>More from the pantry</Eyebrow>
              <h2 className="mt-3 font-serif text-[32px] leading-tight text-ink mobile:text-[24px]">
                You May Also Like
              </h2>
            </div>
            <Link
              to="/shop"
              className="shrink-0 text-bodySm text-green underline underline-offset-4 hover:text-gold-dark"
            >
              View all
            </Link>
          </div>
          <ProductGrid products={related} />
        </section>
      )}
    </div>
  );
}

/**
 * The Product block, as an `AggregateOffer`.
 *
 * A product here has several weights at several prices, which is exactly what
 * `AggregateOffer` describes. Publishing one `Offer` at the cheapest variant would put "from
 * $12.00" in a search result beside a page whose default weight costs $32.50.
 *
 * `aggregateRating` is omitted rather than sent as zero when nothing has been reviewed:
 * Google treats a zero-count rating as invalid markup, and it would be a lie besides.
 */
function productJsonLd(product: ProductDetailResponse['product']): Record<string, unknown> {
  const inStock = product.stockState !== 'out';
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.blurb,
    sku: product.variants.find((variant) => variant.isDefault)?.sku ?? product.variants[0]?.sku,
    category: product.category.name,
    brand: { '@type': 'Brand', name: 'SilkGrain' },
    ...(product.image === null ? {} : { image: [product.image.url] }),
    ...(product.reviews.count > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: product.reviews.average,
            reviewCount: product.reviews.count,
          },
        }
      : {}),
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'USD',
      lowPrice: (product.priceFromCents / 100).toFixed(2),
      highPrice: (product.priceToCents / 100).toFixed(2),
      offerCount: product.variants.length,
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
  };
}

const BADGE_LABELS: Record<string, string> = {
  bestseller: 'Bestseller',
  new: 'New',
  sale: 'Sale',
  organic: 'Organic',
  premium: 'Premium',
};

const CERTIFICATION_LABELS: Record<string, string> = {
  organic: 'USDA Organic',
  non_gmo: 'Non-GMO',
  halal: 'Halal',
  kosher: 'Kosher',
  gluten_free: 'Gluten free',
};

const STOCK_DOT: Record<ProductVariantView['stockState'], string> = {
  in: 'bg-green',
  low: 'bg-gold',
  out: 'bg-terracotta',
};

const STOCK_TEXT: Record<ProductVariantView['stockState'], string> = {
  in: 'text-green',
  low: 'text-gold-dark',
  out: 'text-terracotta',
};

function ProductSkeleton() {
  return (
    <div className="mx-auto max-w-container px-gutter py-8 tablet:px-gutter-tablet mobile:px-gutter-mobile">
      <Skeleton className="h-4 w-64" />
      <div className="mt-8 grid grid-cols-2 gap-16 mobile:grid-cols-1 mobile:gap-8">
        <Skeleton className="aspect-square w-full" />
        <div className="space-y-5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-12 w-4/5" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-11 w-56" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-14 w-full" />
        </div>
      </div>
    </div>
  );
}

export const productRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/product/$slug',
  component: Product,
});
