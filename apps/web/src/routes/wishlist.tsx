import type { ProductListResponse } from '@silkgrain/contracts';
import { Breadcrumb, Button, EmptyState, Eyebrow, Icon } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

import { ButtonLink } from '../components/ButtonLink';
import { ProductGrid, ProductGridSkeleton } from '../components/ProductGrid';
import { apiGet, queryString } from '../lib/api';
import { Seo } from '../lib/seo';
import { useCart } from '../store/cart';
import { useWishlist } from '../store/wishlist';

import { rootRoute } from './root';

/**
 * Saved items.
 *
 * The store holds slugs; `GET /api/products?slug=…` turns them into cards in one request. So a
 * wishlist card carries the same derived badges, price range and stock state as a card in the
 * catalogue, and a product that has since been unpublished simply does not come back - which
 * is also how a stale entry gets pruned below.
 */
function Wishlist() {
  const slugs = useWishlist((state) => state.slugs);
  const remove = useWishlist((state) => state.remove);
  const add = useCart((state) => state.add);

  const query = queryString({ slug: slugs, perPage: 48 });
  const { data, isPending } = useQuery({
    queryKey: ['wishlist', query],
    enabled: slugs.length > 0,
    queryFn: ({ signal }) => apiGet<ProductListResponse>(`/products${query}`, signal),
  });

  const returned = data?.items;

  /**
   * A saved product that no longer exists is dropped from the store.
   *
   * Keeping it would leave a slug the API answers about forever without ever rendering, and
   * the count in the heading would disagree with the number of cards beneath it. In an effect
   * rather than in the render, because writing to a store while rendering is how a render loop
   * starts.
   */
  useEffect(() => {
    if (returned === undefined || returned.length === slugs.length) return;
    const alive = new Set(returned.map((product) => product.slug));
    for (const slug of slugs) if (!alive.has(slug)) remove(slug);
  }, [returned, slugs, remove]);

  // Ordered by the store, not by the API: someone's saves belong in the order they saved them.
  const ordered =
    returned === undefined
      ? []
      : slugs
          .map((slug) => returned.find((product) => product.slug === slug))
          .filter((product): product is NonNullable<typeof product> => product !== undefined);

  const buyable = ordered.filter((product) => product.stockState !== 'out');

  return (
    <div className="mx-auto max-w-container px-gutter py-10 tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:py-6">
      <Seo
        title="Your wishlist — SilkGrain"
        description="The things you have saved for later."
        canonicalPath="/wishlist"
        noIndex
      />

      <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Wishlist' }]} />

      <div className="mt-6 flex items-end justify-between gap-6 mobile:flex-col mobile:items-start mobile:gap-4">
        <div>
          <Eyebrow>Saved for later</Eyebrow>
          <h1 className="mt-3 font-serif text-[42px] leading-tight text-ink mobile:text-[30px]">
            Your wishlist
            {slugs.length > 0 && (
              <span className="ml-3 font-mono text-[18px] text-muted">{slugs.length}</span>
            )}
          </h1>
        </div>

        {buyable.length > 0 && (
          <Button
            variant="outline"
            iconLeft="shopping-bag"
            onClick={() => {
              // Only what can be bought. Adding a sold-out line so the cart could remove it a
              // moment later would be a worse answer than leaving it here.
              for (const product of buyable) add(product.defaultVariantId);
            }}
          >
            Add all to cart ({buyable.length})
          </Button>
        )}
      </div>

      <div className="mt-10 mobile:mt-6">
        {slugs.length === 0 ? (
          <EmptyState
            icon="heart"
            title="Nothing saved yet"
            description="The heart on any product keeps it here while you make up your mind."
            action={<ButtonLink to="/shop">Browse the pantry</ButtonLink>}
          />
        ) : isPending ? (
          <ProductGridSkeleton count={Math.min(slugs.length, 4)} />
        ) : (
          <ProductGrid
            products={ordered}
            trailing={
              <Link
                to="/shop"
                className="flex min-h-[220px] flex-col items-center justify-center gap-3 border border-dashed border-line text-center transition-colors hover:border-green hover:bg-surface"
              >
                <Icon name="plus-circle" size={30} className="text-green" />
                <span className="text-bodySm text-green">Discover more</span>
              </Link>
            }
          />
        )}
      </div>
    </div>
  );
}

export const wishlistRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/wishlist',
  component: Wishlist,
});
