import { Button, EmptyState, Icon, type IconName } from '@silkgrain/ui';
import { Link, Outlet, createRootRoute, useMatches, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

import { SignIn } from '../components/SignIn';
import { useAuth } from '../store/auth';

/**
 * The back office's frame: a 248px `greenDeep` sidebar over an `#EEF1EC` canvas.
 *
 * The panel is behind one gate rather than a guard per route. Every screen in here reads or writes
 * shop data, so "signed in" is the floor for all of them, and a per-route check would be the same
 * condition written eight times with one of them eventually forgotten. Role gates are narrower and
 * do live per screen, and arrive with the first screen that needs one (task 7.8).
 *
 * The nav lists only what exists, the same rule the storefront's header followed while its pages
 * were still landing. It grows as Phase 7 does.
 */
const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Dashboard', icon: 'chart-pie-slice' },
  { to: '/products', label: 'Products', icon: 'package' },
  { to: '/orders', label: 'Orders', icon: 'receipt' },
  { to: '/wholesale', label: 'Wholesale', icon: 'handshake' },
  { to: '/customers', label: 'Customers', icon: 'users' },
  { to: '/promos', label: 'Promo codes', icon: 'tag' },
  { to: '/pricing', label: 'Pricing', icon: 'currency-dollar' },
  { to: '/settings', label: 'Settings', icon: 'gear' },
];

function AdminLayout() {
  const status = useAuth((state) => state.status);
  const admin = useAuth((state) => state.admin);
  const restore = useAuth((state) => state.restore);

  // One silent attempt at restoring the session from the refresh cookie, for the whole panel.
  useEffect(() => {
    void restore();
  }, [restore]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-admin-bg">
        <Icon name="circle-notch" size={28} className="animate-spin text-green" />
      </div>
    );
  }

  if (admin === null) return <SignIn />;

  return (
    <div className="flex min-h-screen bg-admin-bg">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" className="flex-1 px-8 py-7 tablet:px-6 mobile:px-4 mobile:py-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Sidebar() {
  const admin = useAuth((state) => state.admin);
  const signOut = useAuth((state) => state.signOut);

  return (
    // On mobile the handoff turns this into a horizontally scrolling icon strip rather than a
    // drawer: an operator on a phone is checking one figure, not navigating a tree.
    <aside className="flex w-admin-aside shrink-0 flex-col bg-green-deep mobile:h-auto mobile:w-full mobile:flex-row mobile:overflow-x-auto">
      <div className="flex items-center gap-3 px-6 py-6 mobile:shrink-0 mobile:py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-gold text-green-deep">
          <Icon name="grains" size={20} weight="fill" />
        </span>
        <span className="leading-tight">
          <span className="block font-display text-[20px] font-semibold text-ondeep">
            SilkGrain
          </span>
          <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-gold">
            Admin
          </span>
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 mobile:flex-row mobile:items-center mobile:px-2">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.to === '/' }}
            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-bodySm text-ondeep-muted transition-colors hover:bg-white/5 hover:text-ondeep [&.active]:bg-white/10 [&.active]:text-ondeep mobile:shrink-0"
            activeProps={{ className: 'active' }}
          >
            <Icon name={item.icon} size={18} />
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Pinned to the bottom, as the mockup has it. */}
      <div className="border-t border-white/10 p-4 mobile:flex mobile:shrink-0 mobile:items-center mobile:border-l mobile:border-t-0">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-white/10 font-mono text-[12px] text-ondeep">
            {initialsOf(admin?.name ?? '')}
          </span>
          <div className="min-w-0 mobile:hidden">
            <p className="truncate text-bodySm text-ondeep">{admin?.name}</p>
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-gold">
              {ROLE_LABELS[admin?.role ?? 'support']}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void signOut();
            }}
            aria-label="Sign out"
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-ondeep-muted transition-colors hover:bg-white/10 hover:text-ondeep"
          >
            <Icon name="sign-out" size={17} />
          </button>
        </div>
      </div>
    </aside>
  );
}

const ROLE_LABELS = {
  owner: 'Owner',
  manager: 'Store manager',
  support: 'Support',
} as const;

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('');
  return (initials.length > 0 ? initials : '?').toUpperCase();
}

/**
 * The top bar: breadcrumb over a DM Serif page title.
 *
 * The mockup also puts a search field, a notification bell and an "Add Product" button here. None
 * of the three has anywhere to go yet - search needs the product list, the bell needs a
 * notification model - so none is drawn. A dead control in a back office is worse than a missing
 * one: an operator clicks it, nothing happens, and they stop trusting the rest.
 */
function TopBar() {
  /**
   * The matched route's id, not the address bar's path.
   *
   * Two reasons, both of which bit: `router.state` read directly does not subscribe, so the title
   * stayed on whatever it said when the panel mounted; and the pathname carries the `/admin`
   * basepath while `NAV` does not, so every comparison missed and fell back to the first entry.
   * A route id is `/products` on both counts.
   */
  const matches = useMatches();
  const routeId = matches[matches.length - 1]?.routeId;
  const current = NAV.find((item) => item.to === routeId) ?? NAV[0];

  return (
    <header className="flex items-center justify-between gap-6 border-b border-admin-border bg-white px-8 py-5 tablet:px-6 mobile:px-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
          SilkGrain / {current?.label}
        </p>
        <h1 className="mt-1 font-serif text-[26px] leading-tight text-ink">{current?.label}</h1>
      </div>
    </header>
  );
}

function RouteError() {
  const router = useRouter();
  return (
    <div className="py-16">
      <EmptyState
        icon="warning-circle"
        title="Something went wrong"
        description="That screen could not be loaded. It is usually worth trying again."
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
    <div className="py-16">
      <EmptyState
        icon="magnifying-glass"
        title="No such screen"
        description="The link may be old, or that part of the panel is not built yet."
      />
    </div>
  );
}

export const rootRoute = createRootRoute({
  component: AdminLayout,
  errorComponent: RouteError,
  notFoundComponent: NotFound,
});
