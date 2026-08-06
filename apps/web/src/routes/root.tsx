import { Button, EmptyState } from '@silkgrain/ui';
import { Outlet, createRootRoute, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

import { ButtonLink } from '../components/ButtonLink';
import { CartAnnouncer } from '../components/cart/CartAnnouncer';
import { AnnouncementBar } from '../components/layout/AnnouncementBar';
import { SiteFooter } from '../components/layout/SiteFooter';
import { SiteHeader } from '../components/layout/SiteHeader';
import { Seo } from '../lib/seo';
import { useAuth } from '../store/auth';

/**
 * The frame every page sits in.
 *
 * A skip link first, because the header carries a dozen focusable controls and a keyboard
 * user should not have to walk them on every navigation. `main` is the target and is
 * focusable only programmatically, so it never becomes a tab stop of its own.
 */
function RootLayout() {
  // One silent attempt at restoring a session from the refresh cookie, for the whole app. The
  // store guards against running twice, so StrictMode's double effect costs nothing.
  const restore = useAuth((state) => state.restore);
  useEffect(() => {
    void restore();
  }, [restore]);

  return (
    <div className="flex min-h-screen flex-col bg-parchment">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-toast focus:rounded-md focus:bg-green focus:px-4 focus:py-3 focus:text-white"
      >
        Skip to content
      </a>
      <CartAnnouncer />
      <AnnouncementBar />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}

/**
 * A route that threw.
 *
 * Deliberately not a blank page and not a stack trace: the customer gets somewhere to go, and
 * the message stays generic because an error from the API layer may quote an internal detail.
 */
function RouteError() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-container px-gutter py-24 tablet:px-gutter-tablet mobile:px-gutter-mobile">
      <EmptyState
        icon="warning-circle"
        title="Something went wrong"
        description="That page could not be loaded. It is usually worth trying again."
        action={
          <Button
            onClick={() => {
              void router.invalidate();
            }}
          >
            Try again
          </Button>
        }
      />
    </div>
  );
}

/**
 * The 404 the mockup draws, rather than the generic empty state it used to be.
 *
 * The numeral is 140px DM Serif with a gold zero, and it is `aria-hidden` with the code carried
 * in the heading instead: a screen reader announcing "four zero four" as three separate
 * characters before the sentence that explains them is noise, and the sentence is the part that
 * helps. Two ways out, because a 404 is the one page where the visitor has no context to work
 * from — home for someone who mistyped a link, the shop for someone following a dead product URL.
 */
function NotFound() {
  return (
    <div className="mx-auto flex max-w-[760px] flex-col items-center px-gutter py-[72px] text-center tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:py-14">
      {/* `noIndex`, and the canonical points at itself rather than at the home page: telling a
          crawler that a dead URL *is* the home page would have it serve this in place of it.
          The status code is still 200 until Nginx learns to answer 404 for an unknown path,
          which is Phase 9 - so for now this tag is what keeps it out of the index. */}
      <Seo
        title="Page not found — SilkGrain"
        description="That page does not exist or has moved."
        canonicalPath={window.location.pathname}
        noIndex
      />
      <span
        aria-hidden
        className="font-serif text-[140px] leading-none tracking-[0.02em] text-green mobile:text-[92px]"
      >
        4<span className="text-gold">0</span>4
      </span>

      <h1 className="mt-[18px] font-serif text-[36px] leading-tight text-ink mobile:text-[26px]">
        This page wandered off the Silk Road
      </h1>
      <p className="mt-[18px] max-w-[440px] text-body text-body-muted">
        The page you are looking for does not exist or has moved. Let us get you back to the good
        grains.
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3.5">
        <ButtonLink to="/" iconLeft="house">
          Back home
        </ButtonLink>
        <ButtonLink to="/shop" variant="outline">
          Browse the shop
        </ButtonLink>
      </div>
    </div>
  );
}

export const rootRoute = createRootRoute({
  component: RootLayout,
  errorComponent: RouteError,
  notFoundComponent: NotFound,
});
