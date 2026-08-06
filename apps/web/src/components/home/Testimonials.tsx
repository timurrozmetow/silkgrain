import type { TestimonialListResponse } from '@silkgrain/contracts';
import { Card, Eyebrow, Skeleton, StarRating } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { apiGet } from '../../lib/api';

/**
 * "What Our Customers Say", from reviews that exist.
 *
 * The mockup writes three quotes with a name and a city. The quotes here are real moderated
 * five-star reviews and the city is absent, because a review has no city on it and inventing one
 * would be inventing a customer. What replaces it is the product - which the shop does know, and
 * which gives the card somewhere useful to link.
 *
 * The whole section disappears when nothing qualifies. A "what customers say" heading over an
 * empty row says something worse than nothing.
 */
const INITIALS = /(\p{L})\p{L}*/gu;

/** "Aigerim S." becomes "AS". Falls back to the first character for a single-word name. */
function initialsOf(name: string): string {
  const letters = [...name.matchAll(INITIALS)].map((match) => match[1] ?? '');
  const initials = letters.slice(0, 2).join('');
  return (initials.length > 0 ? initials : name.slice(0, 1)).toUpperCase();
}

export function Testimonials() {
  const { data, isPending } = useQuery({
    queryKey: ['testimonials'],
    queryFn: ({ signal }) => apiGet<TestimonialListResponse>('/testimonials?limit=3', signal),
  });

  if (isPending) {
    return (
      <section className="mx-auto max-w-container px-gutter pb-20 tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:pb-12">
        <div className="grid grid-cols-3 gap-6 tablet:gap-5 mobile:grid-cols-1">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-[200px] w-full" />
          ))}
        </div>
      </section>
    );
  }

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section className="mx-auto max-w-container px-gutter pb-20 tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:pb-12">
      <div className="mb-9 text-center mobile:mb-6">
        <Eyebrow>Loved by home cooks</Eyebrow>
        <h2 className="mt-3 font-serif text-[40px] leading-tight text-ink mobile:text-[28px]">
          What Our Customers Say
        </h2>
      </div>

      <ul className="grid grid-cols-3 gap-6 tablet:gap-5 mobile:grid-cols-1">
        {items.map((item) => (
          <li key={item.id}>
            <Card padding="md" className="flex h-full flex-col gap-3">
              {/* `compact` because the number beside five filled stars adds nothing here; the
                  rating is still announced, from the component's own sr-only label. */}
              <StarRating value={item.rating} size="sm" compact />

              <blockquote className="font-display text-[21px] italic leading-[1.4] text-ink">
                &ldquo;{item.body}&rdquo;
              </blockquote>

              <div className="mt-auto flex items-center gap-3 pt-2">
                <span
                  aria-hidden
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sage-bg font-mono text-[13px] text-green"
                >
                  {initialsOf(item.authorName)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-bodySm font-semibold text-ink">{item.authorName}</p>
                  <Link
                    to="/product/$slug"
                    params={{ slug: item.product.slug }}
                    className="truncate font-mono text-[11px] text-muted hover:text-green"
                  >
                    {item.isVerifiedPurchase ? 'Verified buyer · ' : ''}
                    {item.product.name}
                  </Link>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
