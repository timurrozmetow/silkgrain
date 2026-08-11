import { Button, Card, Field, Icon, Input } from '@silkgrain/ui';
import { useState, type FormEvent } from 'react';

/**
 * Order number plus the email it was placed with.
 *
 * The one way a guest reaches an order, and the fallback whenever a session cannot supply it.
 * `orderNumber` is fixed when the form stands on `/order/:number` — there the visitor is already
 * looking at a specific order and only the email is missing.
 */
export function OrderLookupForm({
  orderNumber,
  onSubmit,
  notFound = false,
  busy = false,
}: {
  /** Locked and shown read-only when the page already knows which order. */
  orderNumber?: string;
  onSubmit: (values: { orderNumber: string; email: string }) => void;
  /** The last attempt matched nothing. */
  notFound?: boolean;
  busy?: boolean;
}) {
  const [number, setNumber] = useState(orderNumber ?? '');
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedNumber = number.trim().toUpperCase();
    const trimmedEmail = email.trim();
    if (!/^[A-Z]{2,4}-\d{4}-\d{5}$/.test(trimmedNumber)) {
      setProblem('Order numbers look like SG-2026-00001.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setProblem('Enter the email address the order was placed with.');
      return;
    }
    setProblem(null);
    onSubmit({ orderNumber: trimmedNumber, email: trimmedEmail });
  }

  const message =
    problem ??
    (notFound
      ? // Deliberately vague about which half was wrong: the API will not say either, because
        // saying would turn a walkable sequence of order numbers into a list of real ones.
        'We could not find an order with that number and email.'
      : null);

  return (
    <Card padding="lg" className="mx-auto max-w-md">
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {message !== null && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-terracotta/40 bg-terracotta-bg px-3.5 py-3 text-bodySm text-terracotta"
          >
            <Icon name="warning-circle" size={18} className="mt-0.5 shrink-0" />
            {message}
          </p>
        )}

        <Field label="Order number">
          <Input
            value={number}
            readOnly={orderNumber !== undefined}
            autoComplete="off"
            placeholder="SG-2026-00001"
            iconLeft="receipt"
            onChange={(event) => {
              setNumber(event.target.value);
            }}
          />
        </Field>

        <Field label="Email on the order">
          <Input
            type="email"
            value={email}
            autoComplete="email"
            iconLeft="envelope-simple"
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </Field>

        <Button type="submit" fullWidth loading={busy}>
          Find my order
        </Button>
      </form>
    </Card>
  );
}
