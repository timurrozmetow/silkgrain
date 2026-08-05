import type { ProductCard as ApiProductCard } from '@silkgrain/contracts';
import { ProductCard, Skeleton } from '@silkgrain/ui';

import { toCardProduct } from '../lib/product-card';
import { useCart } from '../store/cart';

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
}: {
  products: ApiProductCard[];
  columns?: 3 | 4;
}) {
  const add = useCart((state) => state.add);

  return (
    <div
      className={`grid gap-6 ${
        columns === 4 ? 'grid-cols-4' : 'grid-cols-3'
      } tablet:grid-cols-3 tablet:gap-5 mobile:grid-cols-2 mobile:gap-4`}
    >
      {products.map((product) => (
        <ProductCard
          key={product.slug}
          product={toCardProduct(product)}
          href={`/product/${product.slug}`}
          onAddToCart={() => {
            // Straight from the grid, using the variant the server marked default. The cart
            // stores the id and nothing else; the price comes back from `/api/cart/validate`.
            add(product.defaultVariantId);
          }}
        />
      ))}
    </div>
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
