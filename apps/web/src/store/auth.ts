import type {
  AuthResult,
  CustomerProfile,
  LoginInput,
  RefreshResult,
  RegisterInput,
} from '@silkgrain/contracts';
import { create } from 'zustand';

import { apiGet, apiPost, registerTokenRefresher, setAccessToken } from '../lib/api';

/**
 * The signed-in customer, on the client.
 *
 * What this store does *not* hold is the access token: that lives in a module variable inside
 * the API layer (decision D-15 keeps it in memory, out of any storage another tab could read),
 * and nothing renders from it, so keeping it in React state would only cost re-renders every
 * fifteen minutes when it rotates. The store keeps the profile the page draws and one flag -
 * whether the silent restore below has run yet, so the account page can tell "not signed in"
 * apart from "we do not know yet" and not flash the sign-in form at a returning customer.
 *
 * The refresh token is an httpOnly cookie the browser holds and no script can read. So a
 * session survives a reload not by persisting anything here but by asking `/auth/refresh` on
 * load whether that cookie is still good - which is exactly what `restore` does.
 */

type Status = 'loading' | 'ready';

interface AuthState {
  status: Status;
  customer: CustomerProfile | null;
  /** Ask the refresh cookie for a session once, at app start. Safe to call more than once. */
  restore: () => Promise<void>;
  signIn: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>()((set) => {
  /**
   * Trade the refresh cookie for a new access token.
   *
   * Deliberately its own `fetch` rather than `apiPost`: the API layer calls this on a 401 to
   * replay the failed request, and routing it back through `apiPost` would let an expired
   * session loop through the retry path forever. A network blip returns null without clearing
   * the session - it is not a sign-out - but a refusal from the server is, so the token and
   * profile both go.
   */
  async function doRefresh(): Promise<string | null> {
    let response: Response;
    try {
      response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
    } catch {
      return null;
    }

    if (!response.ok) {
      setAccessToken(null);
      set({ customer: null });
      return null;
    }

    const body = (await response.json()) as RefreshResult;
    setAccessToken(body.accessToken);
    return body.accessToken;
  }

  /**
   * One refresh at a time, and it matters more here than efficiency.
   *
   * A refresh token rotates on use, and presenting an already-rotated one revokes the whole
   * session family (decision D-15). Two refreshes racing on the same cookie - a 401 retry and
   * the mount-time restore firing together, or React 18's double-invoked effect in development
   * - would do exactly that and sign the customer out. Sharing one in-flight promise makes the
   * second caller await the first instead of spending the cookie twice.
   */
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
    customer: null,

    restore: async () => {
      // Idempotent: the layout mounts once but its effect runs twice under StrictMode, and a
      // second restore would be a second /me for nothing.
      if (restored) return;
      restored = true;

      const token = await refresh();
      if (!token) {
        set({ status: 'ready', customer: null });
        return;
      }
      try {
        const me = await apiGet<CustomerProfile>('/auth/me');
        set({ status: 'ready', customer: me });
      } catch {
        // The cookie refreshed but the profile did not load: treat it as no session rather
        // than a half-signed-in state the rest of the app would have to reason about.
        setAccessToken(null);
        set({ status: 'ready', customer: null });
      }
    },

    signIn: async (input) => {
      const result = await apiPost<AuthResult>('/auth/login', input);
      setAccessToken(result.accessToken);
      set({ status: 'ready', customer: result.customer });
    },

    register: async (input) => {
      const result = await apiPost<AuthResult>('/auth/register', input);
      setAccessToken(result.accessToken);
      set({ status: 'ready', customer: result.customer });
    },

    signOut: async () => {
      try {
        // Revokes the refresh-token family server-side and clears the cookie. Even if it fails
        // - offline, say - the local session is dropped below regardless.
        await apiPost('/auth/logout', {});
      } catch {
        /* the local sign-out below is what the customer sees; the server catches up on reconnect */
      }
      setAccessToken(null);
      set({ customer: null });
    },
  };
});
