import { CART_LINE_MAX_QTY } from '@silkgrain/contracts/constants';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * The cart, which lives here and nowhere else (decision D-18).
 *
 * It holds variant ids and quantities. Not prices, not names, not photographs - those come
 * from `POST /api/cart/validate` on every render of anything that shows money, because the
 * only figures a customer may be shown are the ones the server just computed. A cart that
 * cached its own totals would show a stale price the moment a sale ended, and the checkout
 * would then disagree with it.
 *
 * Persisted to `localStorage`, so a cart survives a closed tab. That is also why the server
 * treats every line as suspect: this store can be months old, and the variant it names may
 * have been retired since.
 */

export interface CartLine {
  variantId: number;
  qty: number;
}

interface CartState {
  lines: CartLine[];
  add: (variantId: number, qty?: number) => void;
  setQty: (variantId: number, qty: number) => void;
  remove: (variantId: number) => void;
  clear: () => void;
}

/** Clamped here as well as on the server: the stepper should not let you ask for 200 bags. */
function clamp(qty: number): number {
  return Math.max(1, Math.min(Math.trunc(qty), CART_LINE_MAX_QTY));
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],

      add: (variantId, qty = 1) => {
        set((state) => {
          const existing = state.lines.find((line) => line.variantId === variantId);
          if (!existing) {
            return { lines: [...state.lines, { variantId, qty: clamp(qty) }] };
          }
          return {
            lines: state.lines.map((line) =>
              line.variantId === variantId ? { ...line, qty: clamp(line.qty + qty) } : line,
            ),
          };
        });
      },

      setQty: (variantId, qty) => {
        set((state) => ({
          // Zero removes the line, which is what the stepper's lower bound means.
          lines:
            qty <= 0
              ? state.lines.filter((line) => line.variantId !== variantId)
              : state.lines.map((line) =>
                  line.variantId === variantId ? { ...line, qty: clamp(qty) } : line,
                ),
        }));
      },

      remove: (variantId) => {
        set((state) => ({ lines: state.lines.filter((line) => line.variantId !== variantId) }));
      },

      clear: () => {
        set({ lines: [] });
      },
    }),
    {
      name: 'silkgrain.cart',
      version: 1,
      // Only the lines. Anything derived is derived again on load, so a shape change here
      // cannot resurrect a stale total from someone's browser.
      partialize: (state) => ({ lines: state.lines }),
    },
  ),
);

/** The number in the header's gold bubble. */
export function useCartCount(): number {
  return useCart((state) => state.lines.reduce((total, line) => total + line.qty, 0));
}
