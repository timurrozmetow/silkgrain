import type { CategoryListResponse, ProductListResponse } from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import { Icon, isIconName, panelVisibility } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { apiGet } from '../../lib/api';

/**
 * The Shop panel.
 *
 * Counts come from `GET /api/categories`, which computes them from the database and folds each
 * category's children in (decision D-21) - so the number here, the number in the shop sidebar
 * and the number on the category page are the same number, and the mockup's hard-coded
 * 24/18/12/9/7/5 never gets a chance to go stale.
 *
 * The featured card is whatever the catalogue currently marks featured, not a hard-coded
 * Devzira. An editor unfeaturing a product should not leave a panel advertising it.
 */
export function MegaMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: ({ signal }) => apiGet<CategoryListResponse>('/categories', signal),
    enabled: open,
  });

  const { data: featured } = useQuery({
    queryKey: ['products', 'featured-one'],
    queryFn: ({ signal }) =>
      apiGet<ProductListResponse>('/products?sort=featured&perPage=1', signal),
    enabled: open,
  });

  const hero = featured?.items[0];

  return (
    <div
      // Not a dialog: it is a menu that opens on hover and closes on leaving the header, so it
      // traps nothing and steals no focus. Keyboard users reach the same links through the
      // Shop link itself, which goes to /shop.
      className={`absolute left-0 top-full w-full border-b border-line bg-surface shadow-[0_30px_60px_rgba(11,46,33,0.12)] transition-[opacity,transform,visibility] duration-base ease-standard mobile:hidden ${panelVisibility(
        open,
      )} ${
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none -translate-y-1 opacity-0'
      }`}
      aria-hidden={!open}
    >
      <div className="mx-auto grid max-w-container grid-cols-[1fr_300px] gap-12 px-gutter py-8 tablet:grid-cols-1 tablet:px-gutter-tablet">
        <ul className="grid grid-cols-3 gap-x-8 gap-y-1">
          {(categories?.items ?? []).map((category) => (
            <li key={category.slug}>
              <Link
                to="/shop"
                search={{ category: category.slug }}
                onClick={onClose}
                className="group flex items-center gap-3 rounded-sm px-3 py-3 transition-colors hover:bg-parchment"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-sage-bg text-green transition-colors group-hover:bg-green group-hover:text-ondeep">
                  <Icon name={isIconName(category.icon) ? category.icon : 'bowl-food'} size={19} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] text-ink group-hover:text-green">
                    {category.name}
                  </span>
                  <span className="block font-mono text-[11px] text-muted">
                    {category.productCount} {category.productCount === 1 ? 'product' : 'products'}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        {hero !== undefined && (
          <Link
            to="/product/$slug"
            params={{ slug: hero.slug }}
            onClick={onClose}
            className="group block border border-line bg-parchment p-5 transition-colors hover:border-green tablet:hidden"
          >
            <span className="flex aspect-square items-center justify-center overflow-hidden bg-gradient-to-br from-white to-gold-pale">
              {hero.image === null ? (
                <Icon name="grains" size={44} className="text-green/25" />
              ) : (
                <img
                  src={hero.image.url}
                  alt={hero.image.alt}
                  className="h-full w-full object-cover transition-transform duration-slow group-hover:scale-[1.04]"
                />
              )}
            </span>
            <span className="mt-4 block font-mono text-[10px] uppercase tracking-[0.16em] text-gold-dark">
              Featured
            </span>
            <span className="mt-1 block font-serif text-[19px] leading-tight text-ink">
              {hero.name}
            </span>
            <span className="mt-2 block font-mono text-[14px] text-green">
              from {Money.fromCents(hero.priceFromCents).format()}
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}
