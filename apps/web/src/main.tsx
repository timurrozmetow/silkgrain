import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@silkgrain/ui/fonts.css';
import '@silkgrain/ui/styles.css';

import { router } from './router';

/**
 * One query client for the session.
 *
 * A catalogue changes when an editor changes it, not between two renders of the same page, so
 * a minute of freshness removes almost every refetch without anyone seeing a stale price. The
 * one set of figures that must always be current is the cart's, and those are never cached
 * because `/api/cart/validate` is a POST.
 *
 * Retries are off for 4xx: a 404 for a slug that does not exist will still not exist on the
 * third attempt, and retrying only delays the "not found" the customer is waiting for.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status ?? 0;
        if (status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
