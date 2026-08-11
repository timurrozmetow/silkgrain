import type {
  AccountSummary,
  CustomerProfile,
  OrderSummary,
  OrderView,
  PageMeta,
} from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import {
  Button,
  Card,
  Checkbox,
  Field,
  Icon,
  Input,
  Pagination,
  Skeleton,
  StatusChip,
  type ChipTone,
} from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

import { ApiRequestError, apiGet } from '../lib/api';
import { Seo } from '../lib/seo';
import { useAuth } from '../store/auth';
import { useCart } from '../store/cart';

/**
 * The account page - two pages wearing one route.
 *
 * Signed out, it is a sign-in / sign-up card. Signed in, it is the dashboard the mockup draws:
 * a sticky profile sidebar, three stat cards and the order history. Which one shows is decided
 * by the auth store, and the third state - `loading`, while the silent refresh in the root
 * layout is still deciding whether the refresh cookie is any good - shows neither, so a
 * returning customer never sees the sign-in form flash before their own name replaces it.
 */
function Account() {
  const status = useAuth((state) => state.status);
  const customer = useAuth((state) => state.customer);

  return (
    <div className="mx-auto max-w-container px-gutter py-10 tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:py-6">
      <Seo
        title="Your account — SilkGrain"
        description="Your orders, saved items and details."
        canonicalPath="/account"
        noIndex
      />

      {status === 'loading' ? (
        <AccountLoading />
      ) : customer ? (
        <Dashboard customer={customer} />
      ) : (
        <AuthPanel />
      )}
    </div>
  );
}

function AccountLoading() {
  return (
    <div className="mx-auto max-w-md py-16">
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="mt-6 h-12 w-full" />
      <Skeleton className="mt-3 h-12 w-full" />
      <Skeleton className="mt-6 h-11 w-full" />
    </div>
  );
}

// ------------------------------------------------------------------------ signed out: the forms

/** A weak client-side check so an obviously empty form does not cost a round trip. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Turns a failed sign-in or sign-up into one sentence for the customer.
 *
 * The server is the authority on every rule, so the client re-checks almost nothing: this maps
 * the code it answers with to something a person can act on. "That email and password do not
 * match" is deliberately vague about which was wrong - telling an attacker that the email
 * exists is exactly the leak the login is careful to avoid.
 */
function authErrorMessage(error: unknown, mode: 'signIn' | 'signUp'): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'NETWORK')
      return 'Could not reach the server. Check your connection and try again.';
    switch (error.status) {
      case 401:
        return 'That email and password do not match.';
      case 409:
        return 'An account already exists for that email. Try signing in instead.';
      case 422:
        return mode === 'signUp'
          ? 'Please check the form: a password needs at least ten characters, including a letter and a number.'
          : 'Please check the details and try again.';
      case 429:
        return 'Too many attempts. Please wait a few minutes and try again.';
      case 403:
        return error.message;
      default:
        return 'Something went wrong. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

function AuthPanel() {
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');

  return (
    <div className="mx-auto max-w-md py-8 mobile:py-2">
      <div className="text-center">
        <h1 className="font-serif text-[38px] leading-tight text-ink mobile:text-[30px]">
          {mode === 'signIn' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="mt-2 text-bodySm text-muted">
          {mode === 'signIn'
            ? 'Sign in to see your orders and saved items.'
            : 'One account for your orders, your wishlist and faster checkout.'}
        </p>
      </div>

      {/* A segmented toggle rather than two routes: the whole panel is one small card, and a
          customer who mistook one for the other should switch without losing what they typed
          in the fields the two forms share. */}
      <div
        role="tablist"
        aria-label="Sign in or create an account"
        className="mt-8 grid grid-cols-2 gap-1 rounded-lg border border-line bg-surface p-1"
      >
        {(['signIn', 'signUp'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => {
              setMode(value);
            }}
            className={`h-10 rounded-md text-bodySm font-semibold transition-colors mobile:h-11 ${
              mode === value ? 'bg-green text-white' : 'text-body hover:text-green'
            }`}
          >
            {value === 'signIn' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      <Card className="mt-5" padding="lg">
        {mode === 'signIn' ? <SignInForm /> : <SignUpForm />}
      </Card>
    </div>
  );
}

function FormError({ children }: { children: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md border border-terracotta/40 bg-terracotta-bg px-3.5 py-3 text-bodySm text-terracotta"
    >
      <Icon name="warning-circle" size={18} className="mt-0.5 shrink-0" />
      {children}
    </p>
  );
}

function SignInForm() {
  const signIn = useAuth((state) => state.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!looksLikeEmail(email) || password.length === 0) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn({ email: email.trim(), password });
      // No navigation: the store flips `customer` and this same route re-renders as the
      // dashboard. Where they were headed before the guard sent them here is out of scope.
    } catch (cause) {
      setError(authErrorMessage(cause, 'signIn'));
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      noValidate
    >
      {error && <FormError>{error}</FormError>}

      <Field label="Email">
        <Input
          type="email"
          autoComplete="email"
          iconLeft="envelope-simple"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </Field>

      <Field label="Password">
        <Input
          type="password"
          autoComplete="current-password"
          iconLeft="lock-simple"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
      </Field>

      <Button type="submit" fullWidth loading={busy}>
        Sign in
      </Button>
    </form>
  );
}

function SignUpForm() {
  const register = useAuth((state) => state.register);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function clientProblem(): string | null {
    if (firstName.trim().length === 0 || lastName.trim().length === 0) {
      return 'Please enter your first and last name.';
    }
    if (!looksLikeEmail(email)) return 'Please enter a valid email address.';
    // Mirrors the server's Password policy for a faster answer than a round trip; the server
    // still has the final say. Duplicated on purpose - importing the Zod schema would pull the
    // whole schema layer into the storefront bundle, which the money subpath exists to avoid.
    if (password.length < 10 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
      return 'Use at least ten characters, including a letter and a number.';
    }
    return null;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const problem = clientProblem();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register({
        email: email.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        marketingOptIn,
      });
    } catch (cause) {
      setError(authErrorMessage(cause, 'signUp'));
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      noValidate
    >
      {error && <FormError>{error}</FormError>}

      <div className="grid grid-cols-2 gap-4 mobile:grid-cols-1">
        <Field label="First name">
          <Input
            autoComplete="given-name"
            value={firstName}
            onChange={(event) => {
              setFirstName(event.target.value);
            }}
          />
        </Field>
        <Field label="Last name">
          <Input
            autoComplete="family-name"
            value={lastName}
            onChange={(event) => {
              setLastName(event.target.value);
            }}
          />
        </Field>
      </div>

      <Field label="Email">
        <Input
          type="email"
          autoComplete="email"
          iconLeft="envelope-simple"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </Field>

      <Field label="Password" hint="At least ten characters, with a letter and a number.">
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

      <Checkbox
        label="Email me occasional news and offers"
        checked={marketingOptIn}
        onChange={(event) => {
          setMarketingOptIn(event.target.checked);
        }}
      />

      <Button type="submit" fullWidth loading={busy}>
        Create account
      </Button>

      <p className="text-center text-caption text-muted">
        By creating an account you agree to our{' '}
        <Link to="/help" className="text-green underline">
          terms
        </Link>
        .
      </p>
    </form>
  );
}

// -------------------------------------------------------------------------- signed in: dashboard

interface OrderPage {
  items: OrderSummary[];
  meta: PageMeta;
}

const ORDERS_PER_PAGE = 8;

function Dashboard({ customer }: { customer: CustomerProfile }) {
  const [page, setPage] = useState(1);

  const summary = useQuery({
    queryKey: ['account', 'summary'],
    queryFn: ({ signal }) => apiGet<AccountSummary>('/account/summary', signal),
  });

  const orders = useQuery({
    queryKey: ['account', 'orders', page],
    queryFn: ({ signal }) =>
      apiGet<OrderPage>(
        `/account/orders?page=${String(page)}&perPage=${String(ORDERS_PER_PAGE)}`,
        signal,
      ),
  });

  return (
    <div className="grid grid-cols-[280px_1fr] gap-8 tablet:grid-cols-1 tablet:gap-6">
      <AccountSidebar customer={customer} />

      <div className="min-w-0">
        <StatCards
          orderCount={summary.data?.orderCount}
          lifetimeSpentCents={summary.data?.lifetimeSpentCents}
        />

        <h2 className="mt-10 font-serif text-[26px] text-ink mobile:mt-8">Order history</h2>

        <div className="mt-5">
          {orders.isPending ? (
            <OrderListSkeleton />
          ) : orders.data && orders.data.items.length > 0 ? (
            <>
              <ul className="flex flex-col gap-4">
                {orders.data.items.map((order) => (
                  <li key={order.orderNumber}>
                    <OrderCard order={order} />
                  </li>
                ))}
              </ul>
              {orders.data.meta.totalPages > 1 && (
                <Pagination
                  className="mt-8"
                  page={orders.data.meta.page}
                  pageCount={orders.data.meta.totalPages}
                  onChange={setPage}
                />
              )}
            </>
          ) : (
            <NoOrders />
          )}
        </div>
      </div>
    </div>
  );
}

function AccountSidebar({ customer }: { customer: CustomerProfile }) {
  const signOut = useAuth((state) => state.signOut);
  const initials = `${customer.firstName.charAt(0)}${customer.lastName.charAt(0)}`.toUpperCase();

  return (
    <aside>
      {/* Unpinned on tablet and below, which is the responsive handoff's rule for every sticky
          column. */}
      <div className="sticky top-[90px] tablet:static">
        <Card padding="md">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-green font-serif text-[20px] text-white">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">
                {customer.firstName} {customer.lastName}
              </p>
              <p className="truncate text-caption text-muted">{customer.email}</p>
            </div>
          </div>

          {/* Only the destinations that exist. Track Order, Addresses, Payment Methods and
              Settings from the mockup have no backing model yet and wait in BACKLOG, so they are
              not printed here as links to nowhere. */}
          <nav className="mt-6 flex flex-col gap-1" aria-label="Account">
            <span className="flex items-center gap-3 rounded-md bg-sage-bg px-3 py-2.5 text-bodySm font-medium text-green">
              <Icon name="receipt" size={18} />
              Order history
            </span>
            <Link
              to="/wishlist"
              className="flex items-center gap-3 rounded-md px-3 py-2.5 text-bodySm text-body transition-colors hover:bg-surface-alt hover:text-green"
            >
              <Icon name="heart" size={18} />
              Wishlist
            </Link>
          </nav>

          <button
            type="button"
            onClick={() => {
              void signOut();
            }}
            className="mt-4 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-bodySm font-medium text-terracotta transition-colors hover:bg-terracotta-bg"
          >
            <Icon name="sign-out" size={18} />
            Sign out
          </button>
        </Card>
      </div>
    </aside>
  );
}

function StatCards({
  orderCount,
  lifetimeSpentCents,
}: {
  orderCount: number | undefined;
  lifetimeSpentCents: number | undefined;
}) {
  return (
    <div className="grid grid-cols-3 gap-5 mobile:grid-cols-1">
      <StatCard
        label="Total orders"
        value={orderCount === undefined ? undefined : String(orderCount)}
        icon="package"
      />
      <StatCard
        label="Lifetime spend"
        value={
          lifetimeSpentCents === undefined
            ? undefined
            : Money.fromCents(lifetimeSpentCents).format()
        }
        icon="currency-dollar"
      />

      {/* The dark card the mockup shows. Grain points have no backing model (BACKLOG), so it
          announces the programme rather than inventing a balance. */}
      <Card variant="deep" padding="md" className="flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-caption uppercase tracking-[0.08em] text-ondeep/70">
            Grain points
          </span>
          <Icon name="gift" size={18} className="text-gold" />
        </div>
        <div className="mt-4">
          <p className="font-serif text-[26px] leading-none text-gold">Coming soon</p>
          <p className="mt-1.5 text-caption text-ondeep/70">Rewards on every order, on the way.</p>
        </div>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | undefined;
  icon: 'package' | 'currency-dollar';
}) {
  return (
    <Card padding="md" className="flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <span className="text-caption uppercase tracking-[0.08em] text-muted">{label}</span>
        <Icon name={icon} size={18} className="text-green" />
      </div>
      <div className="mt-4">
        {value === undefined ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="font-serif text-[32px] leading-none text-ink">{value}</p>
        )}
      </div>
    </Card>
  );
}

/** Order status to the chip tone and label the account history shows. */
const ORDER_CHIP: Record<OrderSummary['status'], { tone: ChipTone; label: string }> = {
  pending: { tone: 'warning', label: 'Pending' },
  paid: { tone: 'info', label: 'Paid' },
  processing: { tone: 'info', label: 'Processing' },
  shipped: { tone: 'info', label: 'Shipped' },
  delivered: { tone: 'positive', label: 'Delivered' },
  cancelled: { tone: 'negative', label: 'Cancelled' },
  refunded: { tone: 'neutral', label: 'Refunded' },
};

function formatOrderDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function OrderCard({ order }: { order: OrderSummary }) {
  const add = useCart((state) => state.add);
  const [reorder, setReorder] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const chip = ORDER_CHIP[order.status];

  async function onReorder() {
    if (reorder === 'busy') return;
    setReorder('busy');
    try {
      // The summary carries no line items, so reordering reads the order back for its variants.
      // A line whose product was retired since (a null variant) is skipped rather than failing
      // the whole reorder; the server would refuse it at validation anyway.
      const full = await apiGet<OrderView>(`/account/orders/${order.orderNumber}`);
      const live = full.items.filter(
        (item): item is typeof item & { variantId: number } => item.variantId !== null,
      );
      if (live.length === 0) {
        setReorder('error');
        return;
      }
      for (const item of live) add(item.variantId, item.qty);
      setReorder('done');
    } catch {
      setReorder('error');
    }
  }

  return (
    <Card padding="md">
      <div className="flex items-center gap-4 mobile:flex-wrap">
        {order.imageUrl ? (
          <img
            src={order.imageUrl}
            alt=""
            className="h-16 w-16 shrink-0 rounded-md border border-line-soft object-cover"
            loading="lazy"
          />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-line-soft bg-surface-alt text-muted">
            <Icon name="package" size={22} />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="font-mono text-bodySm text-ink">{order.orderNumber}</span>
            <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
          </div>
          <p className="mt-1 text-caption text-muted">
            {formatOrderDate(order.createdAt)} · {order.itemCount}{' '}
            {order.itemCount === 1 ? 'item' : 'items'}
          </p>
        </div>

        <div className="flex items-center gap-4 mobile:w-full mobile:justify-between">
          <span className="font-serif text-[20px] text-ink">
            {Money.fromCents(order.totalCents).format()}
          </span>
          <Button
            variant="outline"
            size="sm"
            iconLeft={reorder === 'done' ? 'check' : 'arrow-counter-clockwise'}
            loading={reorder === 'busy'}
            disabled={reorder === 'done'}
            onClick={() => {
              void onReorder();
            }}
          >
            {reorder === 'done' ? 'Added' : 'Reorder'}
          </Button>
        </div>
      </div>

      {reorder === 'error' && (
        <p role="alert" className="mt-3 text-caption text-terracotta">
          Those items are not available to reorder right now.
        </p>
      )}
    </Card>
  );
}

function NoOrders() {
  return (
    <Card padding="lg" className="text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sage-bg text-green">
        <Icon name="package" size={26} />
      </span>
      <h3 className="mt-4 font-serif text-[22px] text-ink">No orders yet</h3>
      <p className="mx-auto mt-2 max-w-sm text-bodySm text-muted">
        When you place your first order it will show up here, ready to track and reorder.
      </p>
      <Link
        to="/shop"
        className="mt-5 inline-flex items-center gap-2 text-bodySm font-semibold text-green"
      >
        Browse the pantry
        <Icon name="arrow-right" size={16} />
      </Link>
    </Card>
  );
}

function OrderListSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: 3 }, (_, index) => (
        <Card key={index} padding="md">
          <div className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 shrink-0 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-9 w-24" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export default Account;
