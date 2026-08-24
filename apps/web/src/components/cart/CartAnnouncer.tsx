import { useEffect, useRef, useState } from 'react';

import { useCartCount } from '../../store/cart';

/**
 * Announces cart changes to a screen reader.
 *
 * "Add to cart" gives no visual confirmation beyond a number in the header changing, and a
 * changed `aria-label` on a button nobody is focused on is announced by nothing. One polite
 * region in the layout covers every way the cart can change - a card, the product page, quick
 * view, the drawer's stepper, Reorder on the account page - which is why it lives here rather
 * than beside any one of them.
 *
 * Deliberately silent on the first render: a cart restored from `localStorage` has not changed,
 * and announcing "3 items in your cart" to somebody who has just arrived is a non sequitur.
 * `polite` rather than `assertive` for the same reason the carousel has no live region at all -
 * this is a confirmation, not an emergency.
 */
export function CartAnnouncer() {
  const count = useCartCount();
  const previous = useRef<number | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const before = previous.current;
    previous.current = count;
    if (before === null || before === count) return;

    setMessage(
      count === 0
        ? 'Your cart is empty'
        : `${String(count)} ${count === 1 ? 'item' : 'items'} in your cart`,
    );
  }, [count]);

  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
