import type { ProductDetailResponse } from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import { Button, Icon, Modal, Skeleton, StarRating, isIconName } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { apiGet } from '../../lib/api';
import { useCart } from '../../store/cart';

/**
 * The 840px preview, opened from a card without leaving the grid.
 *
 * It shares the product route's query key, so opening a quick view warms the cache for the
 * full page and clicking "Full details" is instant. The reverse holds too: a product already
 * visited opens here with no request at all.
 *
 * Deliberately not a second implementation of the product page. It shows what the design
 * draws - category, name, rating, blurb, weights, price, add to cart - and sends anyone who
 * wants nutrition, provenance or reviews to the page that has them.
 */
export function QuickView({ slug, onClose }: { slug: string | null; onClose: () => void }) {
  const open = slug !== null;

  const { data, isPending } = useQuery({
    // The same key the product route uses, so the two share one cache entry.
    queryKey: ['product', slug],
    enabled: open,
    queryFn: ({ signal }) => apiGet<ProductDetailResponse>(`/products/${String(slug)}`, signal),
  });

  return (
    <Modal open={open} onClose={onClose} title={data?.product.name ?? 'Product'} size="quickView">
      {isPending || data === undefined ? (
        <div className="grid grid-cols-2 gap-8 mobile:grid-cols-1">
          <Skeleton className="aspect-square w-full" />
          <div className="space-y-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-11 w-40" />
          </div>
        </div>
      ) : (
        <Body product={data.product} onClose={onClose} />
      )}
    </Modal>
  );
}

function Body({
  product,
  onClose,
}: {
  product: ProductDetailResponse['product'];
  onClose: () => void;
}) {
  const add = useCart((state) => state.add);
  const [variantId, setVariantId] = useState(product.defaultVariantId);

  // Opening a different product through the same modal must not keep the previous choice.
  useEffect(() => {
    setVariantId(product.defaultVariantId);
  }, [product.defaultVariantId]);

  const variant =
    product.variants.find((candidate) => candidate.id === variantId) ?? product.variants[0];
  if (variant === undefined) return null;

  const soldOut = variant.stockState === 'out';

  return (
    <div className="grid grid-cols-2 gap-10 mobile:grid-cols-1 mobile:gap-6">
      <div className="flex aspect-square items-center justify-center overflow-hidden bg-gradient-to-br from-white to-gold-pale">
        {product.image === null ? (
          <Icon
            name={isIconName(product.icon) ? product.icon : 'grains'}
            size={80}
            className="text-green/20"
          />
        ) : (
          <img
            src={product.image.url}
            alt={product.image.alt}
            className="h-full w-full object-cover"
          />
        )}
      </div>

      <div className="flex flex-col">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
          {product.category.name}
        </p>
        <h3 className="mt-2 font-display text-[30px] font-medium leading-tight text-ink">
          {product.name}
        </h3>

        {product.rating !== null && (
          <StarRating
            value={product.rating.average}
            reviewCount={product.rating.count}
            size="sm"
            className="mt-3"
          />
        )}

        <p className="mt-4 text-bodySm text-body-muted">{product.blurb}</p>

        <div className="mt-6 flex flex-wrap gap-2">
          {product.variants.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              aria-pressed={candidate.id === variant.id}
              disabled={candidate.stockState === 'out'}
              onClick={() => {
                setVariantId(candidate.id);
              }}
              className={`min-h-[40px] rounded-sm border px-3.5 font-mono text-[12px] transition-colors disabled:opacity-40 ${
                candidate.id === variant.id
                  ? 'border-green bg-green text-white'
                  : 'border-line bg-surface text-ink hover:border-green'
              }`}
            >
              {candidate.weightLabel}
            </button>
          ))}
        </div>

        <p className="mt-5 font-mono text-[26px] text-ink">
          {Money.fromCents(variant.priceCents).format()}
          <span className="ml-2 text-[13px] text-muted">per {variant.weightLabel}</span>
        </p>

        <div className="mt-auto space-y-3 pt-6">
          <Button
            fullWidth
            corner="sharp"
            disabled={soldOut}
            onClick={() => {
              add(variant.id);
              onClose();
            }}
          >
            {soldOut ? 'Sold out' : 'Add to cart'}
          </Button>
          <Link
            to="/product/$slug"
            params={{ slug: product.slug }}
            onClick={onClose}
            className="block text-center text-bodySm text-green underline underline-offset-4 hover:text-gold-dark"
          >
            Full details
          </Link>
        </div>
      </div>
    </div>
  );
}
