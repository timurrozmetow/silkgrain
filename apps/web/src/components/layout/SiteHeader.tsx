import { Icon, useFocusTrap } from '@silkgrain/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { useCartCount } from '../../store/cart';
import { ButtonLink } from '../ButtonLink';
import { CartDrawer } from '../cart/CartDrawer';

import { MegaMenu } from './MegaMenu';
import { SearchOverlay } from './SearchOverlay';
import { Wordmark } from './Wordmark';

/**
 * The sticky header.
 *
 * Translucent with a backdrop blur, as the mockup has it: the page scrolls visibly underneath
 * rather than disappearing behind an opaque bar. `backdrop-filter` is not universal, so the
 * background colour is opaque enough to stay readable where it is unsupported.
 *
 * Below 760px the centre nav becomes a left slide-in panel. The buttons keep a 44px hit area
 * at every width, which is the responsive handoff's rule and the reason the icon buttons are
 * larger than their glyphs.
 */

/**
 * Grows as the phase does.
 *
 * The design's nav is Shop, Recipes, Wholesale, About and Help. An entry appears here when its
 * page exists: a header full of links to pages that are not built yet looks finished and is
 * not, and it is the kind of thing that survives to launch because everyone assumed somebody
 * else had checked it.
 *
 * Shop is rendered separately because it is the only item with a panel behind it. The others
 * join `NAV` as each page is built.
 */
const SHOP = { to: '/shop', label: 'Shop' } as const;
const NAV = [
  { to: '/recipes', label: 'Recipes' },
  { to: '/about', label: 'About' },
  { to: '/help', label: 'Help' },
] as const;

/** True on a device where hovering is a real gesture rather than an accident of a tap. */
function canHover(): boolean {
  return window.matchMedia('(hover: hover)').matches;
}

export function SiteHeader() {
  const [navOpen, setNavOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [megaOpen, setMegaOpen] = useState(false);
  const cartCount = useCartCount();

  return (
    <>
      {/* The mega-menu closes on leaving the whole header rather than on leaving the Shop link,
          or it would vanish in the gap between the link and the panel below it. A mouse-only
          enhancement by design: keyboard and touch reach the same categories through /shop. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- see above */}
      <header
        className="sticky top-0 z-header border-b border-line bg-surface/[0.92] backdrop-blur-[12px]"
        onMouseLeave={() => {
          setMegaOpen(false);
        }}
      >
        <div className="mx-auto flex h-[74px] max-w-container items-center gap-6 px-gutter tablet:px-gutter-tablet mobile:h-[64px] mobile:px-gutter-mobile">
          <button
            type="button"
            className="hidden h-11 w-11 -ml-2 items-center justify-center text-ink mobile:flex"
            aria-label="Open the menu"
            aria-expanded={navOpen}
            onClick={() => {
              setNavOpen(true);
            }}
          >
            <Icon name="list" size={22} />
          </button>

          <Link to="/" className="shrink-0" aria-label="SilkGrain home">
            <Wordmark />
          </Link>

          <nav
            className="flex flex-1 items-center justify-center gap-8 mobile:hidden"
            aria-label="Primary"
          >
            <Link
              to={SHOP.to}
              className="text-[14px] text-ink transition-colors hover:text-gold-dark [&.active]:text-gold-dark"
              activeProps={{ className: 'active' }}
              onMouseEnter={() => {
                // Only where hovering means something. On a touch screen one tap would both
                // open the panel and follow the link, so there the link simply goes to /shop,
                // which lists every category anyway.
                setMegaOpen(canHover());
              }}
            >
              {SHOP.label}
            </Link>
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="text-[14px] text-ink transition-colors hover:text-gold-dark [&.active]:text-gold-dark"
                activeProps={{ className: 'active' }}
                onMouseEnter={() => {
                  setMegaOpen(false);
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 mobile:gap-0">
            {/* The wishlist and the account menu land with their pages. */}
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center text-ink transition-colors hover:text-green"
              aria-label="Search products"
              aria-expanded={searchOpen}
              onClick={() => {
                setSearchOpen(true);
              }}
            >
              <Icon name="magnifying-glass" size={20} />
            </button>

            <button
              type="button"
              className="relative flex h-11 w-11 items-center justify-center text-ink transition-colors hover:text-green"
              aria-label={cartCount === 0 ? 'Cart, empty' : `Cart, ${String(cartCount)} items`}
              aria-expanded={cartOpen}
              onClick={() => {
                setCartOpen(true);
              }}
            >
              <Icon name="shopping-bag" size={20} />
              {cartCount > 0 && (
                <span
                  className="absolute right-1 top-1 flex min-w-[18px] items-center justify-center rounded-full bg-gold px-1 font-mono text-[10px] leading-[18px] text-green-deep"
                  // The count is already in the button's own label, so this is decoration.
                  aria-hidden
                >
                  {cartCount}
                </span>
              )}
            </button>

            <ButtonLink to="/shop" size="sm" className="ml-2 mobile:hidden">
              Shop Now
            </ButtonLink>
          </div>
        </div>

        <MegaMenu
          open={megaOpen}
          onClose={() => {
            setMegaOpen(false);
          }}
        />
      </header>

      <MobileNav
        open={navOpen}
        onClose={() => {
          setNavOpen(false);
        }}
      />

      <CartDrawer
        open={cartOpen}
        onClose={() => {
          setCartOpen(false);
        }}
      />

      <SearchOverlay
        open={searchOpen}
        onClose={() => {
          setSearchOpen(false);
        }}
      />
    </>
  );
}

/**
 * The mobile panel: 330px or 86vw, whichever is smaller, sliding in from the left.
 *
 * Kept mounted so the slide runs in both directions, and the focus trap engages only while it
 * is open - a trap on a hidden panel would steal focus from the page behind it.
 */
function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, { active: open, onEscape: onClose });

  useEffect(() => {
    if (!open) return;
    // The page behind a modal panel must not scroll under the finger.
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <div
        className={`fixed inset-0 z-overlay bg-scrim transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={open}
        aria-label="Menu"
        aria-hidden={!open}
        className={`fixed left-0 top-0 z-modal flex h-full w-[330px] max-w-[86vw] flex-col bg-surface transition-transform duration-[450ms] ease-[cubic-bezier(.22,1,.36,1)] ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-[64px] items-center justify-between border-b border-line px-5">
          <Wordmark />
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center text-ink"
            aria-label="Close the menu"
            onClick={onClose}
          >
            <Icon name="x" size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2" aria-label="Mobile">
          {[SHOP, ...NAV].map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={onClose}
              className="flex min-h-[52px] items-center justify-between border-b border-line-soft px-5 text-[15px] text-ink"
            >
              {item.label}
              <Icon name="caret-right" size={16} className="text-muted" />
            </Link>
          ))}
        </nav>

        <div className="border-t border-line p-5">
          <ButtonLink to="/shop" fullWidth onClick={onClose}>
            Shop the pantry
          </ButtonLink>
          <p className="mt-3 text-center text-[12px] text-muted">Complimentary shipping over $75</p>
        </div>
      </div>
    </>
  );
}
