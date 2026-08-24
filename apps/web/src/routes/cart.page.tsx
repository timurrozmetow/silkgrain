import { Money } from '@silkgrain/contracts/money';
import { Button, EmptyState, Eyebrow, Icon, Input, Skeleton } from '@silkgrain/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { ButtonLink } from '../components/ButtonLink';
import { CartLineRow } from '../components/cart/CartLineRow';
import { FreeShippingMeter } from '../components/cart/FreeShippingMeter';
import { Seo } from '../lib/seo';
import { useCartQuote } from '../lib/use-cart-quote';

/**
 * The cart page.
 *
 * `1fr 380px`, with the summary sticky, as the mockup draws it. Every figure is the server's:
 * this page does no arithmetic at all, which is why it cannot drift from what the checkout
 * will charge.
 *
 * "Proceed to Checkout" arrives with `/checkout` in Phase 6. Until then the summary ends at
 * the total rather than offering a button that goes nowhere.
 */
function Cart() {
  // Held separately from the applied code: typing into the box must not reprice on every
  // keystroke, and a rejected code has to stay in the field so it can be corrected.
  const [promoDraft, setPromoDraft] = useState('');
  const [promoCode, setPromoCode] = useState<string | undefined>(undefined);

  const { data, isPending, isEmpty } = useCartQuote(promoCode === undefined ? {} : { promoCode });

  // A cart is one person's, and there is nothing on it worth indexing.
  const seo = (
    <Seo
      title="Your cart — SilkGrain"
      description="Review your order before checkout."
      canonicalPath="/cart"
      noIndex
    />
  );

  if (isEmpty) {
    return (
      <div className="mx-auto max-w-container px-gutter py-24 tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:py-14">
        {seo}
        <EmptyState
          icon="shopping-bag"
          title="Your cart is empty"
          description="Nothing in here yet. The pantry is through that door."
          action={<ButtonLink to="/shop">Browse the pantry</ButtonLink>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1180px] px-gutter py-12 tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:py-8">
      {seo}
      <Eyebrow>Your order</Eyebrow>
      <h1 className="mt-3 font-serif text-[42px] leading-tight text-ink mobile:text-[30px]">
        Shopping Cart
      </h1>

      <div className="mt-10 grid grid-cols-[1fr_380px] items-start gap-12 tablet:grid-cols-1 tablet:gap-8 mobile:mt-6 mobile:gap-6">
        <div>
          {data !== undefined && (
            <div className="mb-6 border border-line bg-surface p-5">
              <FreeShippingMeter progress={data.freeShipping} />
            </div>
          )}

          {isPending || data === undefined ? (
            <div className="space-y-6">
              {Array.from({ length: 2 }, (_, index) => (
                <div key={index} className="flex gap-4 py-6">
                  <Skeleton className="h-[84px] w-[84px] shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-1/4" />
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-9 w-32" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ul className="border-t border-line-soft">
              {data.lines.map((line) => (
                <CartLineRow key={line.variantId} line={line} />
              ))}
            </ul>
          )}

          <form
            className="mt-8 flex gap-3 mobile:flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = promoDraft.trim();
              setPromoCode(trimmed.length > 0 ? trimmed : undefined);
            }}
          >
            <Input
              value={promoDraft}
              onChange={(event) => {
                setPromoDraft(event.target.value);
              }}
              placeholder="Promo code"
              aria-label="Promo code"
              className="max-w-[240px] mobile:max-w-none"
            />
            <Button type="submit" variant="outline">
              Apply
            </Button>
          </form>

          {/* Reported rather than thrown, so an expired code never hides the cart itself. */}
          {data?.promoRejected != null && (
            <p className="mt-3 flex items-center gap-2 text-[13px] text-terracotta">
              <Icon name="warning-circle" size={15} />
              {data.promoRejected.message}
            </p>
          )}

          <Link
            to="/shop"
            className="mt-8 inline-flex items-center gap-2 text-bodySm text-green hover:text-gold-dark"
          >
            <Icon name="arrow-left" size={15} />
            Continue shopping
          </Link>
        </div>

        <aside className="sticky top-[96px] border border-line bg-surface p-7 tablet:static mobile:p-5">
          <h2 className="font-serif text-[22px] text-ink">Order Summary</h2>

          <dl className="mt-6 space-y-3 text-[14px]">
            <Row label="Subtotal" value={data?.subtotalCents} />
            {data !== undefined && data.discountCents > 0 && (
              <Row
                label={data.promo === null ? 'Discount' : `Discount (${data.promo.code})`}
                value={-data.discountCents}
                tone="discount"
              />
            )}
            <Row label="Shipping" value={data?.shippingCents} free={data?.shippingCents === 0} />
            <Row label="Estimated tax" value={data?.taxCents} />
          </dl>

          <div className="mt-5 flex items-baseline justify-between border-t border-line pt-5">
            <span className="text-[17px] text-ink">Total</span>
            <span className="font-mono text-[26px] text-ink">
              {data === undefined ? '—' : Money.fromCents(data.totalCents).format()}
            </span>
          </div>

          {/* Decision D-4: the rate is the default one, and Stripe Tax is authoritative once
              checkout knows the address. Saying so beats a total that quietly changes. */}
          <p className="mt-3 text-[12px] text-muted">
            Tax is estimated at the default rate and confirmed at checkout, once we know where the
            parcel is going.
          </p>

          <p className="mt-6 flex items-center gap-2 text-[12px] text-muted">
            <Icon name="lock-simple" size={14} className="text-green" />
            Secure checkout, SSL encrypted
          </p>
        </aside>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  free = false,
  tone,
}: {
  label: string;
  value: number | undefined;
  free?: boolean;
  tone?: 'discount';
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-body-muted">{label}</dt>
      <dd className={`font-mono ${tone === 'discount' ? 'text-green' : 'text-ink'}`}>
        {value === undefined ? '—' : free ? 'Free' : Money.fromCents(value).format()}
      </dd>
    </div>
  );
}

export default Cart;
