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
 * A far shorter freshness window than the storefront's minute: an operator who has just changed a
 * price and gone back to the list expects to see it. Fifteen seconds is long enough to stop a
 * refetch storm while somebody clicks between screens, and short enough that nobody works from a
 * stale figure without noticing.
 *
 * Refetching on window focus is on here and off in the storefront, for the same reason: coming
 * back to the tab is exactly when an operator wants today's numbers rather than this morning's.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status ?? 0;
        // A 401 is handled by the transport's refresh-and-replay; retrying past that is pointless,
        // and retrying a 403 or a 404 is worse than pointless.
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
