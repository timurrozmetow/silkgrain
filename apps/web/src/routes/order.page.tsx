import type { OrderView } from '@silkgrain/contracts';
import { Button, Card, Field, Icon, Input, Skeleton, StatusChip } from '@silkgrain/ui';
import { Link, getRouteApi } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

import { ButtonLink } from '../components/ButtonLink';
import { OrderLookupForm } from '../components/order/OrderLookupForm';
import { OrderSummaryCard } from '../components/order/OrderSummaryCard';
import { useOrder } from '../components/order/use-order';
import { ApiRequestError } from '../lib/api';
import { ORDER_CHIP, formatOrderDate } from '../lib/order-status';
import { Seo } from '../lib/seo';
import { useAuth } from '../store/auth';
import { useCart } from '../store/cart';

/**
 * The order confirmation screen.
 *
 * A signed-in customer needs nothing but the number in the address. A guest is asked for the
 * email the order was placed with, because the API will not hand over an order to a bare number
 * - the numbers are a sequence and can be walked. When Phase 6's checkout exists it will already
 * know that email and can hand it over in router state, so the form is skipped for the one
 * visitor who has just typed it; until then, and for anyone returning to the link later, the form
 * is the way in.
 *
 * The mockup's referral band - "give 10% off, get 10% off" - is not built: referral codes,
 * attribution and fraud limits are a programme, not a banner, and it is in `BACKLOG.md`.
 */
const route = getRouteApi('/order/$orderNumber');

function OrderConfirmation() {
  const { orderNumber } = route.useParams();
  const [email, setEmail] = useState<string | null>(null);
  const clearCart = useCart((state) => state.clear);
  const query = useOrder(orderNumber, email);

  const notFound =
    query.error instanceof ApiRequestError &&
    (query.error.status === 404 || query.error.status === 422 || query.error.status === 401);

  const seo = (
    <Seo
      title={`Order ${orderNumber} — SilkGrain`}
      description="Your order confirmation."
      canonicalPath={`/order/${orderNumber}`}
      noIndex
    />
  );

  if (query.data === undefined) {
    return (
      <div className="mx-auto max-w-container px-gutter py-14 tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:py-8">
        {seo}
        <div className="mx-auto max-w-md text-center">
          <h1 className="font-serif text-[32px] leading-tight text-ink mobile:text-[26px]">
            Your order
          </h1>
          <p className="mt-2 text-bodySm text-muted">
            <span className="font-mono text-ink">{orderNumber}</span> — enter the email it was
            placed with to see it.
          </p>
        </div>
        <div className="mt-8">
          <OrderLookupForm
            orderNumber={orderNumber}
            onSubmit={(values) => {
              setEmail(values.email);
            }}
            notFound={notFound}
            busy={query.isFetching && !notFound}
          />
        </div>
        {query.isFetching && !notFound && <Skeleton className="mx-auto mt-6 h-4 w-40" />}
      </div>
    );
  }

  const order = query.data;
  const chip = ORDER_CHIP[order.status];
  const paid = order.paidAt !== null;

  return (
    <div className="mx-auto max-w-[720px] px-gutter py-14 tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:py-8">
      {seo}

      <div className="text-center">
        <span
          className={`mx-auto flex h-[68px] w-[68px] items-center justify-center rounded-pill ${
            paid ? 'bg-sage-bg text-green' : 'bg-gold-bg text-gold-dark'
          }`}
        >
          <Icon name={paid ? 'check-circle' : 'clock-countdown'} size={34} weight="fill" />
        </span>

        <h1 className="mt-6 font-serif text-[44px] leading-tight text-ink mobile:text-[30px]">
          {paid ? 'Thank you' : 'Order received'}
        </h1>
        <p className="mt-3 text-body text-body-muted">
          {paid
            ? `A confirmation is on its way to ${order.email}.`
            : 'This order is waiting on its payment. Nothing has been charged yet.'}
        </p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <span className="rounded-pill border border-line bg-surface px-4 py-2 font-mono text-bodySm text-ink">
            {order.orderNumber}
          </span>
          <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
        </div>

        <p className="mt-3 font-mono text-[12px] text-muted">
          Placed {formatOrderDate(order.createdAt)} · dispatched from Houston within 48 hours
        </p>
      </div>

      <div className="mt-10">
        <OrderSummaryCard order={order} />
      </div>

      <div className="mt-8 flex items-center justify-center gap-4 mobile:flex-col mobile:items-stretch">
        <ButtonLink to="/track" iconLeft="truck">
          Track your order
        </ButtonLink>
        <ButtonLink to="/shop" variant="outline">
          Continue shopping
        </ButtonLink>
      </div>

      <ClaimAccount order={order} />

      {/* The cart is cleared here rather than on the redirect, and only by asking: the order is
          on the screen, so this cannot lose a cart that never became one. */}
      <Card padding="md" className="mt-10 flex items-center justify-between gap-4 mobile:flex-col">
        <p className="text-bodySm text-body-muted">
          Still have these items in your cart? Clear it now that the order is placed.
        </p>
        <Button
          variant="outline"
          size="sm"
          iconLeft="trash"
          onClick={() => {
            clearCart();
          }}
        >
          Clear cart
        </Button>
      </Card>

      <p className="mt-8 text-center text-caption text-muted">
        Questions about this order?{' '}
        <Link to="/help" className="text-green underline underline-offset-4">
          Ask us
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * One-click registration for a guest who has just ordered — task 6.5's second half.
 *
 * The order already carries the email and the name, so all that is left to ask for is a password.
 *
 * What this deliberately does **not** do is attach the order to the new account. Claiming orders
 * by email at registration would mean anyone could register with somebody else's address and
 * inherit their order history, addresses and totals — and there is no email verification yet to
 * stand in the way. So the offer says what it actually delivers, faster checkout next time, and
 * `BACKLOG.md` holds the claiming step behind verification, where it belongs.
 */
function ClaimAccount({ order }: { order: OrderView }) {
  const status = useAuth((state) => state.status);
  const customer = useAuth((state) => state.customer);
  const register = useAuth((state) => state.register);
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (status !== 'ready' || customer !== null) return null;

  if (state === 'done') {
    return (
      <Card padding="md" className="mt-10 flex items-center gap-3">
        <Icon name="check-circle" size={20} weight="fill" className="shrink-0 text-green" />
        <p className="text-bodySm text-body-muted">
          Account created for {order.email}. Your next order will be a good deal quicker.
        </p>
      </Card>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'busy') return;
    if (password.length < 10 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
      setError('Use at least ten characters, including a letter and a number.');
      return;
    }
    setState('busy');
    setError(null);
    try {
      await register({
        email: order.email,
        password,
        firstName: order.shippingAddress.firstName,
        lastName: order.shippingAddress.lastName,
        marketingOptIn: false,
      });
      setState('done');
    } catch (cause) {
      setState('idle');
      setError(
        cause instanceof ApiRequestError && cause.status === 409
          ? 'There is already an account for this email. Sign in instead.'
          : 'That did not work. Please try again.',
      );
    }
  }

  return (
    <Card padding="md" className="mt-10">
      <h2 className="font-serif text-[22px] text-ink">Save your details</h2>
      <p className="mt-1.5 text-bodySm text-body-muted">
        Pick a password and {order.email} becomes an account — one field at checkout next time
        instead of eight.
      </p>

      <form
        className="mt-4 flex items-end gap-3 mobile:flex-col mobile:items-stretch"
        onSubmit={(event) => {
          void submit(event);
        }}
        noValidate
      >
        <Field label="Password" className="flex-1">
          <Input
            type="password"
            autoComplete="new-password"
            iconLeft="lock-simple"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </Field>
        <Button type="submit" loading={state === 'busy'}>
          Create account
        </Button>
      </form>

      {error !== null && (
        <p role="alert" className="mt-3 text-caption font-medium text-terracotta">
          {error}
        </p>
      )}
    </Card>
  );
}

export default OrderConfirmation;
