import type { ReviewBreakdown } from '@silkgrain/contracts';
import { StarRating } from '@silkgrain/ui';

/**
 * The Reviews tab: an average, a five-star histogram and the published reviews.
 *
 * There is no "Write a Review" button. The `reviews` table is moderated and seeded, and
 * customer submissions need verified-buyer checks against order history, a moderation queue
 * and spam handling - it is a backlog item with an estimate (decision D-13). A button that
 * opened a form nobody could submit would be worse than its absence.
 */
export function ReviewsPanel({ reviews }: { reviews: ReviewBreakdown }) {
  if (reviews.count === 0) {
    return (
      <p className="text-body text-body-muted">
        No reviews yet. This one is waiting for its first cook.
      </p>
    );
  }

  const stars = [5, 4, 3, 2, 1] as const;

  return (
    <div className="grid grid-cols-[260px_1fr] gap-14 tablet:gap-8 mobile:grid-cols-1 mobile:gap-8">
      <div>
        <p className="font-mono text-[46px] leading-none text-ink">{reviews.average}</p>
        <StarRating value={reviews.average} size="md" compact className="mt-3" />
        <p className="mt-2 text-[13px] text-muted">
          {reviews.count} {reviews.count === 1 ? 'review' : 'reviews'}
        </p>

        <ul className="mt-6 space-y-2">
          {stars.map((star) => {
            const count = reviews.histogram[String(star) as '1' | '2' | '3' | '4' | '5'];
            const percent = reviews.count === 0 ? 0 : Math.round((count / reviews.count) * 100);
            return (
              <li key={star} className="flex items-center gap-3">
                <span className="w-8 shrink-0 font-mono text-[12px] text-muted">{star}★</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                  <span
                    className="block h-full rounded-full bg-gold"
                    style={{ width: `${String(percent)}%` }}
                  />
                </span>
                <span className="w-6 shrink-0 text-right font-mono text-[12px] text-muted">
                  {count}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <ul className="divide-y divide-line-soft">
        {reviews.items.map((review) => (
          <li key={review.id} className="py-6 first:pt-0">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sage-bg font-mono text-[12px] text-green">
                {initials(review.authorName)}
              </span>
              <div>
                <p className="text-[14px] text-ink">{review.authorName}</p>
                <p className="text-[12px] text-muted">
                  {new Date(review.publishedAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                  {review.isVerifiedPurchase && (
                    <span className="ml-2 text-green">&middot; Verified purchase</span>
                  )}
                </p>
              </div>
            </div>
            <StarRating value={review.rating} size="sm" compact className="mt-3" />
            {review.title !== null && (
              <p className="mt-3 font-serif text-[18px] text-ink">{review.title}</p>
            )}
            <p className="mt-2 text-bodySm text-body-muted">{review.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}
