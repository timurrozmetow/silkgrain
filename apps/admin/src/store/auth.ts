import type {
  AdminAuthResult,
  AdminProfile,
  LoginInput,
  RefreshResult,
} from '@silkgrain/contracts';
import { create } from 'zustand';

import { apiGet, apiPost, registerTokenRefresher, setAccessToken } from '../lib/api';

/**
 * The signed-in administrator.
 *
 * Mirrors the storefront's session store and talks to the other contour: `/api/auth/admin/*`, a
 * separate cookie, a separate token audience. The role comes back with the profile and is what
 * every gate in the panel reads - and it is re-read on refresh rather than carried over, so a
 * demotion takes effect at the next fifteen-minute boundary instead of thirty days later.
 */

type Status = 'loading' | 'ready';

interface AuthState {
  status: Status;
  admin: AdminProfile | null;
  restore: () => Promise<void>;
  signIn: (input: LoginInput) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>()((set) => {
  async function doRefresh(): Promise<string | null> {
    let response: Response;
    try {
      response = await fetch('/api/auth/admin/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
    } catch {
      // A dropped connection is not a sign-out; the session may still be perfectly good.
      return null;
    }

    if (!response.ok) {
      setAccessToken(null);
      set({ admin: null });
      return null;
    }

    const body = (await response.json()) as RefreshResult;
    setAccessToken(body.accessToken);
    return body.accessToken;
  }

  /** One refresh at a time: two racing on one rotating cookie revoke the session family. */
  let inFlight: Promise<string | null> | null = null;
  function refresh(): Promise<string | null> {
    inFlight ??= doRefresh().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  registerTokenRefresher(refresh);

  let restored = false;

  return {
    status: 'loading',
    admin: null,

    restore: async () => {
      // Idempotent: the layout mounts once but its effect runs twice under StrictMode.
      if (restored) return;
      restored = true;

      const token = await refresh();
      if (!token) {
        set({ status: 'ready', admin: null });
        return;
      }
      try {
        const me = await apiGet<AdminProfile>('/auth/admin/me');
        set({ status: 'ready', admin: me });
      } catch {
        setAccessToken(null);
        set({ status: 'ready', admin: null });
      }
    },

    signIn: async (input) => {
      const result = await apiPost<AdminAuthResult>('/auth/admin/login', input);
      setAccessToken(result.accessToken);
      set({ status: 'ready', admin: result.admin });
    },

    signOut: async () => {
      try {
        await apiPost('/auth/admin/logout', {});
      } catch {
        /* the local sign-out below is what the operator sees; the server catches up on reconnect */
      }
      setAccessToken(null);
      set({ admin: null });
    },
  };
});

/**
 * A role gate belongs here and is not written yet.
 *
 * The dashboard is readable by every role, so a `useHasRole` helper would have no caller - and an
 * exported helper with no caller is a guess about what the first gated screen will need. It
 * arrives with that screen, in task 7.8, where the roles it lists can be checked against
 * something real.
 */
