import type { ProductCard as ApiProductCard } from '@silkgrain/contracts';
import { type ProductCardProduct, isIconName } from '@silkgrain/ui';

/**
 * From the API's card to the design system's.
 *
 * They are close but not identical, and deliberately so: `packages/ui` knows nothing about the
 * API, so `ProductCard` can be dropped into Storybook with invented data. This is the one
 * place the two shapes meet, which is also the only place that has to change when either moves.
 */
export function toCardProduct(product: ApiProductCard): ProductCardProduct {
  return {
    slug: product.slug,
    name: product.name,
    blurb: product.blurb,
    categoryName: product.category.name,
    badges: product.badges,
    // The card wants a number and a count; the API sends null when nothing has been reviewed.
    rating: product.rating?.average ?? 0,
    reviewCount: product.rating?.count ?? 0,
    stockState: product.stockState,
    weightLabels: product.weightLabels,
    priceFromCents: product.priceFromCents,
    ...(product.image === null ? {} : { image: product.image }),
    // An editor can type any Phosphor name into the admin panel, but only the registry ships.
    fallbackIcon: isIconName(product.icon) ? product.icon : 'grains',
  };
}
