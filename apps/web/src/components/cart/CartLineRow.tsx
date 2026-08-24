import type { CartQuoteLine } from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import { Icon, QuantityStepper } from '@silkgrain/ui';
import { Link } from '@tanstack/react-router';

import { useCart } from '../../store/cart';

/**
 * One line, in the drawer and on the cart page.
 *
 * The stepper writes to the store; the figures beside it come from the server's quote and are
 * never recomputed here. So a quantity change moves the number in the box immediately and the
 * money a moment later, when the recalculation lands - which is the honest order, because the
 * price is not ours to decide.
 */
export function CartLineRow({ line, compact = false }: { line: CartQuoteLine; compact?: boolean }) {
  const setQty = useCart((state) => state.setQty);
  const remove = useCart((state) => state.remove);

  return (
    <li className={`flex gap-4 ${compact ? 'py-4' : 'py-6'} border-b border-line-soft`}>
      <Link
        to="/product/$slug"
        params={{ slug: line.productSlug }}
        className={`${compact ? 'h-16 w-16' : 'h-[84px] w-[84px]'} shrink-0 overflow-hidden bg-gold-pale`}
      >
        {line.image === null ? (
          <span className="flex h-full w-full items-center justify-center">
            <Icon name="grains" size={24} className="text-green/30" />
          </span>
        ) : (
          <img
            src={line.image.url}
            alt={line.image.alt}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
          {line.categoryName}
        </p>
        <Link
          to="/product/$slug"
          params={{ slug: line.productSlug }}
          className={`mt-1 block truncate ${compact ? 'text-[15px]' : 'text-[17px]'} text-ink hover:text-green`}
        >
          {line.name}
        </Link>
        <p className="mt-1 text-[13px] text-muted">
          {line.weightLabel} &middot; {Money.fromCents(line.unitPriceCents).format()} each
        </p>

        <div className="mt-3 flex items-center gap-4">
          <QuantityStepper
            value={line.qty}
            min={1}
            max={line.availableQty}
            size={compact ? 'sm' : 'md'}
            label={`Quantity of ${line.name}, ${line.weightLabel}`}
            onChange={(value) => {
              setQty(line.variantId, value);
            }}
          />
          <button
            type="button"
            className="flex h-9 items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-terracotta"
            onClick={() => {
              remove(line.variantId);
            }}
          >
            <Icon name="trash" size={15} />
            Remove
          </button>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className={`font-mono ${compact ? 'text-[15px]' : 'text-[17px]'} text-ink`}>
          {Money.fromCents(line.lineTotalCents).format()}
        </p>
        {line.compareAtPriceCents !== null && (
          <p className="mt-1 font-mono text-[12px] text-muted line-through">
            {Money.fromCents(line.compareAtPriceCents * line.qty).format()}
          </p>
        )}
        {line.stockState === 'low' && (
          <p className="mt-1 text-[11px] text-gold-dark">Only {line.availableQty} left</p>
        )}
      </div>
    </li>
  );
}
