import type { FreeShippingProgress } from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import { Icon } from '@silkgrain/ui';

/**
 * "You're $12.40 away from free shipping."
 *
 * Every figure comes from the server's quote, including the threshold: the checkout charges
 * from `shipping_rates.free_above_cents` (decision D-22), so anything this bar computed for
 * itself would be a second opinion about the same number.
 */
export function FreeShippingMeter({
  progress,
  className,
}: {
  progress: FreeShippingProgress | null;
  className?: string;
}) {
  if (progress === null) return null;

  return (
    <div className={className}>
      <p className="flex items-center gap-2 text-[13px] text-ink">
        <Icon
          name={progress.qualified ? 'check-circle' : 'truck'}
          size={16}
          className={progress.qualified ? 'text-green' : 'text-gold-dark'}
        />
        {progress.qualified ? (
          <span>
            Your order ships <strong className="font-semibold text-green">free</strong>
          </span>
        ) : (
          <span>
            You&rsquo;re{' '}
            <strong className="font-semibold">
              {Money.fromCents(progress.remainingCents).format()}
            </strong>{' '}
            away from free shipping
          </span>
        )}
      </p>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={progress.progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progress towards free shipping"
      >
        <div
          className="h-full rounded-full bg-green transition-[width] duration-slow ease-standard"
          style={{ width: `${String(progress.progressPercent)}%` }}
        />
      </div>
    </div>
  );
}
