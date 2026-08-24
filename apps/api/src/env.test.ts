import { describe, expect, it } from 'vitest';

import { loadEnv, parseDuration } from './env';

const VALID = {
  DATABASE_URL: 'mysql://root:secret@127.0.0.1:3307/silkgrain',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  STRIPE_SECRET_KEY: 'sk_test_example',
  STRIPE_WEBHOOK_SECRET: 'whsec_example',
  VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_example',
  MAIL_FROM_ADDRESS: 'orders@silkgrain.com',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_BUCKET: 'silkgrain-media',
  S3_ACCESS_KEY_ID: 'silkgrain',
  S3_SECRET_ACCESS_KEY: 'silkgrain-dev-secret',
  S3_PUBLIC_URL: 'http://127.0.0.1:9000/silkgrain-media',
};

/** What production additionally demands, so a placeholder cannot reach a live deployment. */
const PRODUCTION = {
  ...VALID,
  NODE_ENV: 'production',
  COOKIE_SECURE: 'true',
};

describe('parseDuration', () => {
  it('reads the forms .env uses', () => {
    expect(parseDuration('45s')).toBe(45);
    expect(parseDuration('15m')).toBe(900);
    expect(parseDuration('12h')).toBe(43_200);
    expect(parseDuration('30d')).toBe(2_592_000);
  });

  it('refuses anything it cannot read exactly', () => {
    expect(() => parseDuration('15 minutes')).toThrow();
    expect(() => parseDuration('1.5h')).toThrow();
    expect(() => parseDuration('')).toThrow();
  });
});

describe('loadEnv', () => {
  it('accepts a complete configuration and splits the CORS list', () => {
    const env = loadEnv({ ...VALID, CORS_ORIGINS: 'http://a.test, http://b.test' });

    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(env.API_PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadEnv({ ...VALID, API_PORT: '70000' })).toThrow(/API_PORT/);
  });

  it('rejects a missing database URL rather than starting without one', () => {
    const { DATABASE_URL: _ignored, ...withoutDatabase } = VALID;
    expect(() => loadEnv(withoutDatabase)).toThrow(/DATABASE_URL/);
  });

  it('rejects the placeholder secrets from .env.example', () => {
    expect(() =>
      loadEnv({ ...VALID, JWT_ACCESS_SECRET: 'replace-me-with-a-48-byte-random-string' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects a short secret', () => {
    expect(() => loadEnv({ ...VALID, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('refuses to reuse one secret for both token kinds', () => {
    expect(() => loadEnv({ ...VALID, JWT_REFRESH_SECRET: VALID.JWT_ACCESS_SECRET })).toThrow(
      /JWT_REFRESH_SECRET/,
    );
  });

  it('refuses an insecure refresh cookie in production', () => {
    expect(() => loadEnv({ ...VALID, NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(
      /COOKIE_SECURE/,
    );
    expect(loadEnv({ ...VALID, NODE_ENV: 'production', COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(
      true,
    );
  });

  it('boots on the Stripe placeholders in development but not in production', () => {
    // Everything except the two calls that reach Stripe works without an account, so a
    // developer with no keys still gets a running API.
    expect(loadEnv({ ...VALID, STRIPE_SECRET_KEY: 'sk_test_replace_me' }).STRIPE_SECRET_KEY).toBe(
      'sk_test_replace_me',
    );

    expect(() => loadEnv({ ...PRODUCTION, STRIPE_SECRET_KEY: 'sk_test_replace_me' })).toThrow(
      /STRIPE_SECRET_KEY/,
    );
    expect(() => loadEnv({ ...PRODUCTION, STRIPE_WEBHOOK_SECRET: 'whsec_replace_me' })).toThrow(
      /STRIPE_WEBHOOK_SECRET/,
    );
  });

  it('lets a catalogue-only deployment boot with no Stripe account at all', () => {
    // D-51. Without this the only way onto a VPS is putting the published placeholders in a
    // production .env, which hands the order pipeline to anyone who can read this repository.
    const {
      STRIPE_SECRET_KEY: _secret,
      STRIPE_WEBHOOK_SECRET: _webhook,
      VITE_STRIPE_PUBLISHABLE_KEY: _publishable,
      ...withoutStripe
    } = PRODUCTION;

    const env = loadEnv({ ...withoutStripe, PAYMENTS_ENABLED: 'false' });
    expect(env.PAYMENTS_ENABLED).toBe(false);
    expect(env.STRIPE_SECRET_KEY).toBe('');

    // Even the placeholders are fine once nothing reads them.
    expect(() =>
      loadEnv({
        ...PRODUCTION,
        PAYMENTS_ENABLED: 'false',
        STRIPE_SECRET_KEY: 'sk_live_replace_me',
      }),
    ).not.toThrow();
  });

  it('demands the keys while payments are on, and defaults to on', () => {
    expect(loadEnv(VALID).PAYMENTS_ENABLED).toBe(true);

    // Absent is as bad as placeholder: an operator who forgot must not get a quiet catalogue.
    const { STRIPE_SECRET_KEY: _dropped, ...missing } = VALID;
    expect(() => loadEnv(missing)).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => loadEnv({ ...VALID, STRIPE_WEBHOOK_SECRET: '' })).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it('accepts only a plausible order-number prefix', () => {
    expect(loadEnv(VALID).ORDER_NUMBER_PREFIX).toBe('SG');
    expect(loadEnv({ ...VALID, ORDER_NUMBER_PREFIX: 'SILK' }).ORDER_NUMBER_PREFIX).toBe('SILK');
    expect(() => loadEnv({ ...VALID, ORDER_NUMBER_PREFIX: 'sg' })).toThrow(/ORDER_NUMBER_PREFIX/);
    expect(() => loadEnv({ ...VALID, ORDER_NUMBER_PREFIX: 'TOOLONG' })).toThrow(
      /ORDER_NUMBER_PREFIX/,
    );
  });
});
