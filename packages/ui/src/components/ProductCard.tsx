import type { ReactElement } from 'react';

import { cn } from '../cn';

import { Badge, type BadgeTone } from './Badge';
import { Icon, type IconName } from './Icon';
import { PriceTag } from './PriceTag';
import { StarRating } from './StarRating';

export type StockState = 'in' | 'low' | 'out';

export interface ProductCardProduct {
  slug: string;
  name: string;
  blurb: string;
  categoryName: string;
  badges: readonly BadgeTone[];
  rating: number;
  reviewCount: number;
  stockState: StockState;
  /** Weight labels shown under the rating, e.g. ["2 lb", "5 lb", "10 lb"]. */
  weightLabels: readonly string[];
  priceFromCents: number;
  compareAtCents?: number;
  image?: { url: string; alt: string };
  /** Phosphor icon shown behind the image while it loads, or when there is no photo. */
  fallbackIcon: IconName;
}

export interface ProductCardProps {
  product: ProductCardProduct;
  href: string;
  /**
   * Called instead of following `href`, so a router can navigate without a full page load.
   *
   * The element stays an anchor either way: middle-click, the context menu, "copy link" and
   * the status bar all keep working, and a crawler still sees a destination. Only the plain
   * left click is intercepted.
   */
  onNavigate?: (href: string) => void;
  onQuickView?: (slug: string) => void;
  onAddToCart?: (slug: string) => void;
  onToggleWishlist?: (slug: string) => void;
  wishlisted?: boolean;
  className?: string;
}

const BADGE_LABELS: Record<BadgeTone, string> = {
  bestseller: 'Bestseller',
  new: 'New',
  sale: 'Sale',
  organic: 'Organic',
  premium: 'Premium',
};

const STOCK: Record<StockState, { label: string; className: string }> = {
  in: { label: 'In stock', className: 'text-green-muted' },
  low: { label: 'Low stock', className: 'text-gold-dark' },
  out: { label: 'Sold out', className: 'text-terracotta' },
};

/**
 * The catalog product card, reproducing `ProductCardPremium.dc.html`.
 *
 * The mockup makes the whole card a click target with three buttons inside it, which nests
 * interactive elements. Here the product name is the link and it stretches over the card
 * with a pseudo-element, so the card still clicks anywhere while the buttons stay separate
 * controls and the accessible name of the link is the product itself.
 */
export function ProductCard({
  product,
  href,
  onNavigate,
  onQuickView,
  onAddToCart,
  onToggleWishlist,
  wishlisted = false,
  className,
}: ProductCardProps): ReactElement {
  const stock = STOCK[product.stockState];

  return (
    <article
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-[10px]',
        'border border-[#ECE4D3] bg-surface shadow-card',
        'transition-[transform,box-shadow,border-color] duration-slow ease-standard',
        'hover:-translate-y-1.5 hover:border-[#D9CBA8] hover:shadow-cardHover',
        'focus-within:-translate-y-1.5 focus-within:shadow-cardHover',
        className,
      )}
    >
      <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#FFFFFF_0%,#F1E9DA_100%)]">
        <Icon name={product.fallbackIcon} size={58} className="text-[rgba(30,62,47,0.22)]" />

        {product.image && (
          <img
            src={product.image.url}
            alt={product.image.alt}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-image ease-standard group-hover:scale-[1.07]"
          />
        )}

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(40,30,10,0.04),inset_0_-38px_46px_-30px_rgba(40,30,10,0.13)]"
        />

        {product.badges.length > 0 && (
          <div className="absolute left-3 top-3 z-10 flex flex-col gap-1.5">
            {product.badges.map((tone) => (
              <Badge key={tone} tone={tone}>
                {BADGE_LABELS[tone]}
              </Badge>
            ))}
          </div>
        )}

        {onToggleWishlist && (
          <button
            type="button"
            onClick={() => {
              onToggleWishlist(product.slug);
            }}
            aria-pressed={wishlisted}
            aria-label={
              wishlisted
                ? `Remove ${product.name} from wishlist`
                : `Save ${product.name} to wishlist`
            }
            className={cn(
              'absolute right-3 top-3 z-10 flex h-[34px] w-[34px] items-center justify-center',
              'rounded-pill bg-[rgba(253,250,244,0.92)] shadow-[0_2px_8px_rgba(0,0,0,0.1)]',
              'transition-[color,background-color,transform] duration-base',
              'hover:scale-105 hover:bg-terracotta hover:text-white',
              wishlisted ? 'text-terracotta' : 'text-muted',
            )}
          >
            <Icon name="heart" weight={wishlisted ? 'fill' : 'regular'} size={17} />
          </button>
        )}

        {onQuickView && (
          <button
            type="button"
            onClick={() => {
              onQuickView(product.slug);
            }}
            className={cn(
              'absolute bottom-3 right-3 z-10 inline-flex items-center gap-1.5',
              'rounded-pill bg-white px-3.5 py-2 text-[12.5px] font-semibold text-green',
              'shadow-[0_4px_12px_rgba(0,0,0,0.16)] transition-colors duration-base',
              'hover:bg-green hover:text-white',
            )}
          >
            <Icon name="eye" size={14} />
            Quick view
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 px-4 pb-[18px] pt-4">
        <span className="text-microLabel font-semibold uppercase tracking-[0.1em] text-label">
          {product.categoryName}
        </span>

        <h3 className="font-display text-cardTitle font-semibold text-ink">
          {/* The stretched pseudo-element turns the whole card into this link's hit area. */}
          <a
            href={href}
            className="after:absolute after:inset-0 after:content-['']"
            onClick={
              onNavigate === undefined
                ? undefined
                : (event) => {
                    // Modified clicks mean "open elsewhere", which is the browser's job.
                    if (event.defaultPrevented) return;
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    if (event.button !== 0) return;
                    event.preventDefault();
                    onNavigate(href);
                  }
            }
          >
            {product.name}
          </a>
        </h3>

        <p className="flex-1 text-caption leading-[1.45] text-muted">{product.blurb}</p>

        <div className="mt-1 flex items-center gap-1.5">
          <StarRating value={product.rating} reviewCount={product.reviewCount} size="sm" />
          <span
            className={cn('ml-auto inline-flex items-center gap-1.5 text-[11px]', stock.className)}
          >
            <span aria-hidden="true" className="h-[7px] w-[7px] rounded-pill bg-current" />
            {stock.label}
          </span>
        </div>

        <span className="font-mono text-[11px] tracking-[0.02em] text-muted-soft">
          {product.weightLabels.join('   ·   ')}
        </span>

        <div className="mt-2.5 flex items-center justify-between gap-2.5 border-t border-[#EFE7D6] pt-3">
          <PriceTag
            cents={product.priceFromCents}
            compareAtCents={product.compareAtCents}
            showFrom={product.weightLabels.length > 1}
            size="md"
          />

          {onAddToCart && (
            <button
              type="button"
              disabled={product.stockState === 'out'}
              onClick={() => {
                onAddToCart(product.slug);
              }}
              // The visible label leads, then the product. A name that reads "Add Devzira Red
              // Rice to cart" beside a button that says "Add to Cart" fails
              // `label-content-name-mismatch`: voice control users say what they see, and "add
              // to cart" has to match something. Same words, order changed.
              aria-label={`Add to Cart: ${product.name}`}
              className={cn(
                'relative z-10 inline-flex items-center gap-1.5 rounded-md bg-green px-4 py-2.5',
                'text-caption font-semibold text-white',
                'transition-[background-color,transform] duration-base',
                'hover:-translate-y-px hover:bg-green-hover',
                'disabled:pointer-events-none disabled:opacity-40',
              )}
            >
              <Icon name="shopping-cart-simple" size={15} />
              Add to Cart
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
