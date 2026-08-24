import type { ProductCard as ApiProductCard } from '@silkgrain/contracts';
import { ProductCard, Skeleton } from '@silkgrain/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';

import { toCardProduct } from '../lib/product-card';
import { useCart } from '../store/cart';
import { useWishlist } from '../store/wishlist';

import { QuickView } from './shop/QuickView';

/**
 * The grid every listing uses.
 *
 * Four across on the desktop container, three on tablet and two on mobile - product grids are
 * the one thing the responsive handoff keeps multi-column at every width, because a
 * single-column list of photographs is a very long page.
 */
export function ProductGrid({
  products,
  columns = 4,
  trailing,
}: {
  products: ApiProductCard[];
  columns?: 3 | 4;
  /** An extra cell after the last card - the wishlist's dashed "Discover more" tile. */
  trailing?: ReactNode;
}) {
  const add = useCart((state) => state.add);
  const toggleWishlist = useWishlist((state) => state.toggle);
  const wishlisted = useWishlist((state) => state.slugs);
  const navigate = useNavigate();
  // Owned by the grid rather than by each card, so one modal serves the whole listing and
  // closing it cannot leave a second one mounted underneath.
  const [quickViewSlug, setQuickViewSlug] = useState<string | null>(null);

  return (
    <>
      {/* The mockup pairs each column count with its own gap - 24px at four across, 22px at
          three, where the grid sits beside a sidebar and the cards are narrower. `columns`
          already distinguishes those two cases, so nothing new has to be passed in. */}
      <div
        className={`grid ${
          columns === 4 ? 'grid-cols-4 gap-6' : 'grid-cols-3 gap-[22px]'
        } tablet:grid-cols-3 tablet:gap-5 mobile:grid-cols-2 mobile:gap-4`}
      >
        {products.map((product) => (
          <ProductCard
            key={product.slug}
            product={toCardProduct(product)}
            href={`/product/${product.slug}`}
            onNavigate={() => {
              void navigate({ to: '/product/$slug', params: { slug: product.slug } });
            }}
            wishlisted={wishlisted.includes(product.slug)}
            onToggleWishlist={() => {
              toggleWishlist(product.slug);
            }}
            onQuickView={() => {
              setQuickViewSlug(product.slug);
            }}
            onAddToCart={() => {
              // Straight from the grid, using the variant the server marked default. The cart
              // stores the id and nothing else; the price comes back from `/api/cart/validate`.
              add(product.defaultVariantId);
            }}
          />
        ))}
        {trailing}
      </div>

      <QuickView
        slug={quickViewSlug}
        onClose={() => {
          setQuickViewSlug(null);
        }}
      />
    </>
  );
}

export function ProductGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-4 gap-6 tablet:grid-cols-3 tablet:gap-5 mobile:grid-cols-2 mobile:gap-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="space-y-3">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}
