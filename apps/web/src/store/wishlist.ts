import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * The wishlist: product slugs, in the browser.
 *
 * Slugs rather than ids, because that is what a URL carries and what
 * `GET /api/products?slug=…` takes - so the page turns the whole list into cards in one
 * request, through the same projection every other grid uses.
 *
 * Client-side for the same reason the cart is (decision D-18): a guest has nowhere to put one
 * server-side, and a visitor who has not signed in is most visitors. The `wishlists` and
 * `wishlist_items` tables exist for the day a signed-in list should follow someone between
 * devices; nothing writes them yet, and a table nothing writes to would be a stub.
 */

interface WishlistState {
  slugs: string[];
  toggle: (slug: string) => void;
  remove: (slug: string) => void;
  clear: () => void;
}

/** Newest first, which is the order someone expects their own saves in. */
export const useWishlist = create<WishlistState>()(
  persist(
    (set) => ({
      slugs: [],
      toggle: (slug) => {
        set((state) => ({
          slugs: state.slugs.includes(slug)
            ? state.slugs.filter((entry) => entry !== slug)
            : [slug, ...state.slugs],
        }));
      },
      remove: (slug) => {
        set((state) => ({ slugs: state.slugs.filter((entry) => entry !== slug) }));
      },
      clear: () => {
        set({ slugs: [] });
      },
    }),
    { name: 'silkgrain.wishlist', version: 1, partialize: (state) => ({ slugs: state.slugs }) },
  ),
);

export function useIsWishlisted(slug: string): boolean {
  return useWishlist((state) => state.slugs.includes(slug));
}

export function useWishlistCount(): number {
  return useWishlist((state) => state.slugs.length);
}
