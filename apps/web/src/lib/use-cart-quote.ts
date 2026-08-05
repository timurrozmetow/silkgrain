import type { CartQuote, ShippingMethod } from '@silkgrain/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useCart } from '../store/cart';

import { apiPost } from './api';

/**
 * The priced cart.
 *
 * Every screen that shows money asks the server for it. The store holds variant ids and
 * quantities; this is the only thing that turns them into figures, so the drawer, the cart
 * page and the header can never disagree about a total.
 *
 * The query key is the lines themselves, so changing a quantity refetches and nothing else
 * does. It is a POST, which means React Query will not serve it from any HTTP cache either.
 */
export interface CartQuoteOptions {
  promoCode?: string;
  shippingMethod?: ShippingMethod;
  /** Skips the request when a drawer is closed and nothing is on screen to price. */
  enabled?: boolean;
}

export function useCartQuote(options: CartQuoteOptions = {}) {
  const lines = useCart((state) => state.lines);
  const remove = useCart((state) => state.remove);
  const setQty = useCart((state) => state.setQty);

  const enabled = (options.enabled ?? true) && lines.length > 0;

  const query = useQuery({
    queryKey: ['cart', lines, options.promoCode ?? null, options.shippingMethod ?? 'standard'],
    enabled,
    queryFn: () =>
      apiPost<CartQuote>('/cart/validate', {
        lines,
        ...(options.promoCode === undefined ? {} : { promoCode: options.promoCode }),
        ...(options.shippingMethod === undefined ? {} : { shippingMethod: options.shippingMethod }),
      }),
  });

  /**
   * Whatever the server changed, the store changes too.
   *
   * A cart written to `localStorage` in March can name a variant that was retired in June, and
   * the quote comes back with it removed. Leaving it in the store would mean it is silently
   * dropped from every total while still sitting in the list, and the next request would ask
   * about it again. The server's answer is the truth; this makes the store agree with it.
   */
  const adjustments = query.data?.adjustments;
  useEffect(() => {
    if (!adjustments || adjustments.length === 0) return;
    for (const adjustment of adjustments) {
      if (adjustment.reason === 'qty_reduced') {
        setQty(adjustment.variantId, adjustment.acceptedQty);
      } else {
        remove(adjustment.variantId);
      }
    }
  }, [adjustments, remove, setQty]);

  return {
    ...query,
    /** True when there is nothing to price, which is not the same as a request in flight. */
    isEmpty: lines.length === 0,
  };
}
