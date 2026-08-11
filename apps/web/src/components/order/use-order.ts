import type { OrderView } from '@silkgrain/contracts';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '../../lib/api';
import { useAuth } from '../../store/auth';

/**
 * Reading one order, by whichever door the visitor has.
 *
 * A signed-in customer needs nothing but the number - the session says who is asking. A guest
 * needs the email the order was placed with, because order numbers are a per-year sequence and
 * can be walked; the API answers 404 to a wrong email and to a number never issued, identically
 * and on purpose.
 *
 * The email lives in React state, never in the URL. `?email=` is the API's contract, not the
 * page's: an address in the address bar ends up in history, in a shared link and in whatever
 * analytics the site later grows.
 *
 * When an email has been supplied it wins over the session, so the guest form is also the way a
 * signed-in customer looks up an order that is not theirs to begin with.
 */
export function useOrder(orderNumber: string, email: string | null) {
  const authReady = useAuth((state) => state.status === 'ready');
  const customer = useAuth((state) => state.customer);
  const asGuest = email !== null;

  return useQuery({
    // The identity is part of the key: signing out must not leave another customer's order in
    // the cache under a bare order number.
    queryKey: ['order', orderNumber, asGuest ? email : (customer?.id ?? null)],
    // Nothing to ask with until the silent refresh has decided whether there is a session.
    enabled: authReady && (asGuest || customer !== null),
    queryFn: ({ signal }) =>
      asGuest
        ? apiGet<OrderView>(`/orders/${orderNumber}?email=${encodeURIComponent(email)}`, signal)
        : apiGet<OrderView>(`/account/orders/${orderNumber}`, signal),
    retry: false,
  });
}
