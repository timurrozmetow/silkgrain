import { Button, Card, Field, Icon, Input } from '@silkgrain/ui';
import { useState, type FormEvent } from 'react';

import { ApiRequestError } from '../lib/api';
import { useAuth } from '../store/auth';

/**
 * The admin sign-in.
 *
 * No design exists for it (Q-28), so it is the mockup's vocabulary at the smallest size that
 * works: the dark canvas, the gold logo tile, one card. Deliberately plain - this screen is seen
 * once a month by three people.
 *
 * It is rendered in place of the panel rather than as a route. A `/login` path would need a
 * redirect back to wherever the operator was going, and a redirect target read from the URL is a
 * thing to get wrong; here the panel simply appears once the session does.
 */
export function SignIn() {
  const signIn = useAuth((state) => state.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (email.trim().length === 0 || password.length === 0) {
      setError('Enter your email and password.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await signIn({ email: email.trim(), password });
    } catch (cause) {
      setBusy(false);
      setError(messageFor(cause));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-green-deep px-4">
      <div className="w-full max-w-[380px]">
        <div className="flex items-center justify-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-sm bg-gold text-green-deep">
            <Icon name="grains" size={22} weight="fill" />
          </span>
          <span className="leading-tight">
            <span className="block font-display text-[24px] font-semibold text-ondeep">
              SilkGrain
            </span>
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-gold">
              Admin
            </span>
          </span>
        </div>

        <Card padding="lg" className="mt-8">
          <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
            {error !== null && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md border border-terracotta/40 bg-terracotta-bg px-3.5 py-3 text-bodySm text-terracotta"
              >
                <Icon name="warning-circle" size={18} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}

            <Field label="Email">
              <Input
                type="email"
                autoComplete="username"
                iconLeft="envelope-simple"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
            </Field>

            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                iconLeft="lock-simple"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
            </Field>

            <Button type="submit" fullWidth loading={busy}>
              Sign in
            </Button>
          </form>
        </Card>

        <p className="mt-5 text-center text-caption text-ondeep-muted">
          Staff access only. Every action in here is recorded.
        </p>
      </div>
    </div>
  );
}

function messageFor(cause: unknown): string {
  if (cause instanceof ApiRequestError) {
    if (cause.code === 'NETWORK') return 'Could not reach the server.';
    switch (cause.status) {
      case 401:
        // Vague on purpose, exactly as the storefront's is: which half was wrong is not something
        // to tell someone guessing.
        return 'That email and password do not match.';
      case 403:
        return cause.message;
      case 429:
        return 'Too many attempts. Wait a few minutes and try again.';
      default:
        return 'Something went wrong. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}
