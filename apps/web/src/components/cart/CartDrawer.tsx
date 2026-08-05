import { Money } from '@silkgrain/contracts/money';
import { Drawer, EmptyState, Skeleton } from '@silkgrain/ui';

import { useCartQuote } from '../../lib/use-cart-quote';
import { ButtonLink } from '../ButtonLink';

import { CartLineRow } from './CartLineRow';
import { FreeShippingMeter } from './FreeShippingMeter';

/**
 * The cart, without leaving the page.
 *
 * Priced by the server like everything else, and only while it is open - a closed drawer has
 * nothing on screen to be wrong about, so it does not ask.
 *
 * The footer's primary action is "View full cart" rather than "Checkout" because `/checkout`
 * is Phase 6. It becomes the checkout button when there is a checkout to send anyone to.
 */
export function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isPending, isEmpty } = useCartQuote({ enabled: open });

  const itemCount = data?.itemCount ?? 0;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-baseline gap-2">
          Your cart
          {itemCount > 0 && (
            <span className="font-mono text-[13px] text-muted">
              {itemCount} {itemCount === 1 ? 'item' : 'items'}
            </span>
          )}
        </span>
      }
      ariaLabel="Your cart"
      footer={
        isEmpty ? undefined : (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] text-ink">Subtotal</span>
              <span className="font-mono text-[19px] text-ink">
                {data === undefined ? '—' : Money.fromCents(data.subtotalCents).format()}
              </span>
            </div>
            <p className="text-[12px] text-muted">Shipping and tax are calculated in the cart.</p>
            <ButtonLink to="/cart" fullWidth corner="sharp" onClick={onClose}>
              View full cart
            </ButtonLink>
          </div>
        )
      }
    >
      {isEmpty ? (
        <EmptyState
          icon="shopping-bag"
          title="Your cart is empty"
          description="Rice, lentils, dried fruit and spices, direct from the growers."
          action={
            <ButtonLink to="/shop" onClick={onClose}>
              Start shopping
            </ButtonLink>
          }
        />
      ) : (
        <>
          {data !== undefined && (
            <FreeShippingMeter progress={data.freeShipping} className="pb-5" />
          )}

          {isPending || data === undefined ? (
            <div className="space-y-4">
              {Array.from({ length: 2 }, (_, index) => (
                <div key={index} className="flex gap-4 py-4">
                  <Skeleton className="h-16 w-16 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-8 w-28" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ul>
              {data.lines.map((line) => (
                <CartLineRow key={line.variantId} line={line} compact />
              ))}
            </ul>
          )}
        </>
      )}
    </Drawer>
  );
}
