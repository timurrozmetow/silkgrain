import { Button, EmptyState } from '@silkgrain/ui';
import { Outlet, createRootRoute, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

import { ButtonLink } from '../components/ButtonLink';
import { AnnouncementBar } from '../components/layout/AnnouncementBar';
import { SiteFooter } from '../components/layout/SiteFooter';
import { SiteHeader } from '../components/layout/SiteHeader';
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

function NotFound() {
  return (
    <div className="mx-auto max-w-container px-gutter py-24 tablet:px-gutter-tablet mobile:px-gutter-mobile">
      <EmptyState
        icon="magnifying-glass"
        title="We could not find that page"
        description="The link may be old, or the address may have a typo in it."
        action={<ButtonLink to="/shop">Browse the pantry</ButtonLink>}
      />
    </div>
  );
}

export const rootRoute = createRootRoute({
  component: RootLayout,
  errorComponent: RouteError,
  notFoundComponent: NotFound,
});
