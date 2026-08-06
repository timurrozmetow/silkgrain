import type { ProductCard, ProductListResponse } from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import { Icon, Skeleton } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { apiGet } from '../../lib/api';

/**
 * The home page's featured panel.
 *
 * The mockup's three slides are two products and a `WELCOME10` welcome offer. The products are
 * real and come from `?sort=featured`, so an editor ticking "featured" changes the front page
 * without a deploy. The offer slide is not built: a promo code printed in the markup is a
 * promise the database may not keep - the code could expire overnight, or never exist in
 * production - and the announcement bar already carries that message from a setting the owner
 * edits.
 *
 * Autoplay obeys three things, and all three are the difference between a carousel and a
 * nuisance: it stops while the pointer is over the panel or focus is inside it, it does not run
 * at all under `prefers-reduced-motion`, and the slides live in a labelled region rather than an
 * `aria-live` one - announcing every automatic change would talk over whatever the visitor is
 * actually reading.
 */
const SLIDE_MS = 5500;
const SLIDE_COUNT = 3;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function FeaturedSlider() {
  const { data, isPending } = useQuery({
    queryKey: ['products', 'featured-slider'],
    queryFn: ({ signal }) =>
      apiGet<ProductListResponse>(`/products?sort=featured&perPage=${String(SLIDE_COUNT)}`, signal),
  });

  const slides = data?.items ?? [];
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Clamped rather than reset: a shorter list must not leave the panel showing nothing, and
  // resetting to zero would fight the visitor if the query refetched while they were reading.
  const current = slides.length === 0 ? 0 : Math.min(index, slides.length - 1);

  useEffect(() => {
    if (slides.length < 2 || paused || prefersReducedMotion()) return;
    const timer = window.setInterval(() => {
      setIndex((value) => (value + 1) % slides.length);
    }, SLIDE_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [slides.length, paused]);

  if (isPending) {
    return (
      <div className="mx-auto max-w-container px-gutter pt-8 tablet:px-gutter-tablet mobile:px-gutter-mobile">
        <Skeleton className="h-[480px] w-full rounded-[18px] mobile:h-[320px]" />
      </div>
    );
  }

  if (slides.length === 0) return null;

  const shown = slides[current];
  if (!shown) return null;

  function go(next: number) {
    setIndex(((next % slides.length) + slides.length) % slides.length);
  }

  return (
    <div className="mx-auto max-w-container px-gutter pt-8 tablet:px-gutter-tablet mobile:px-gutter-mobile">
      {/* Hover and focus pause the autoplay, which is what stops a carousel from advancing out
          from under somebody reading it or tabbing through its controls. A keyboard user is
          covered by the focus half; there is nothing to activate on the region itself, so it
          stays non-interactive rather than growing a key handler that does nothing. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- see above */}
      <section
        aria-roledescription="carousel"
        aria-label="Featured products"
        className="relative overflow-hidden rounded-[18px]"
        onMouseEnter={() => {
          setPaused(true);
        }}
        onMouseLeave={() => {
          setPaused(false);
        }}
        onFocus={() => {
          setPaused(true);
        }}
        onBlur={(event) => {
          // Only when focus actually leaves the panel, not on every hop between its controls.
          if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
        }}
      >
        <Slide product={shown} position={current + 1} total={slides.length} />

        {slides.length > 1 && (
          <>
            {/* Indicators bottom-left, arrows bottom-right, as the mockup has them. */}
            <div className="absolute bottom-7 left-8 flex gap-2 mobile:bottom-4 mobile:left-5">
              {slides.map((slide, position) => (
                <button
                  key={slide.slug}
                  type="button"
                  aria-label={`Show ${slide.name}`}
                  aria-current={position === current}
                  onClick={() => {
                    go(position);
                  }}
                  className={`h-[3px] rounded-pill transition-all duration-base ${
                    position === current ? 'w-9 bg-gold' : 'w-4 bg-white/45 hover:bg-white/70'
                  }`}
                />
              ))}
            </div>

            <div className="absolute bottom-6 right-8 flex gap-2 mobile:bottom-3 mobile:right-5">
              {(
                [
                  ['arrow-left', 'Previous slide', current - 1],
                  ['arrow-right', 'Next slide', current + 1],
                ] as const
              ).map(([icon, label, target]) => (
                <button
                  key={label}
                  type="button"
                  aria-label={label}
                  onClick={() => {
                    go(target);
                  }}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white backdrop-blur-[6px] transition-colors hover:bg-white/30"
                >
                  <Icon name={icon} size={18} />
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Slide({
  product,
  position,
  total,
}: {
  product: ProductCard;
  position: number;
  total: number;
}) {
  return (
    <div
      role="group"
      aria-roledescription="slide"
      aria-label={`${String(position)} of ${String(total)}: ${product.name}`}
      className="relative flex h-[480px] items-end mobile:h-[320px]"
      // The card's own gradient, so a slide matches the product it advertises. Photography is
      // still a placeholder (Q-8); `tone` is what the mockup uses behind an image while it loads.
      style={{ background: product.tone ?? 'linear-gradient(135deg,#0B3D2C,#0E6B4A)' }}
    >
      {product.image && (
        <img
          src={product.image.url}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
      )}
      {/* A wash dark enough for white text to clear AA over any photograph behind it. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-[rgba(10,35,25,0.86)] via-[rgba(10,35,25,0.35)] to-transparent"
      />

      <div className="relative w-full px-8 pb-[86px] mobile:px-5 mobile:pb-[70px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold">
          {product.category.name}
        </p>
        <h2 className="mt-3 max-w-[18ch] font-display text-[52px] font-medium leading-[1.06] text-white tablet:text-[42px] mobile:text-[30px]">
          {product.name}
        </h2>
        <p className="mt-3 max-w-[46ch] text-bodySm text-white/80 mobile:hidden">{product.blurb}</p>
        <div className="mt-6 flex items-center gap-5 mobile:mt-4 mobile:gap-3">
          <Link
            to="/product/$slug"
            params={{ slug: product.slug }}
            className="inline-flex h-11 items-center rounded-sharp bg-surface-warm px-6 text-bodySm font-semibold text-ink transition-transform hover:-translate-y-0.5"
          >
            Shop {product.category.name}
          </Link>
          <span className="font-mono text-bodySm text-white">
            from {Money.fromCents(product.priceFromCents).format()}
          </span>
        </div>
      </div>
    </div>
  );
}
