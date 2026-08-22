import { z } from 'zod';

/**
 * Parses durations written the way `.env` writes them: `15m`, `30d`, `45s`, `12h`.
 * Returns seconds, which is what both `@fastify/jwt` and the cookie `maxAge` want.
 */
export function parseDuration(input: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(input.trim());
  if (!match) throw new Error(`Not a duration: "${input}". Use forms like 15m, 12h, 30d.`);
  const [, amount = '0', unit = 's'] = match;
  const multiplier = { s: 1, m: 60, h: 3600, d: 86_400 }[unit] ?? 1;
  return Number(amount) * multiplier;
}

const Duration = z.string().refine((value) => {
  try {
    parseDuration(value);
    return true;
  } catch {
    return false;
  }
}, 'Use a duration such as 15m, 12h or 30d');

/**
 * A secret has to be long enough that brute-forcing the signature is not the cheapest attack,
 * and it must not still be the placeholder from `.env.example`.
 */
const Secret = z
  .string()
  .min(32, 'Use at least 32 characters')
  .refine((value) => !value.startsWith('replace-me'), 'Still the placeholder from .env.example');

/**
 * Process configuration. Parsed once at boot: a missing or malformed variable must crash
 * the process immediately, not surface as `undefined` halfway through a checkout.
 *
 * Only variables the code actually reads are listed. Stripe, PayPal, SMTP and S3 arrive with
 * the phases that use them, so a missing payment key cannot fail a boot that never needed it.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
    PUBLIC_ADMIN_URL: z.string().url().default('http://localhost:5174'),
    /** Comma-separated. Never `*`: the refresh cookie makes this a credentialed origin list. */
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173,http://localhost:5174')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),

    DATABASE_URL: z.string().url(),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    REDIS_URL: z.string().url(),

    JWT_ACCESS_SECRET: Secret,
    JWT_REFRESH_SECRET: Secret,
    JWT_ACCESS_TTL: Duration.default('15m'),
    JWT_REFRESH_TTL: Duration.default('30d'),

    COOKIE_DOMAIN: z.string().default('localhost'),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    /** Decision D-3. Two to four letters; the rest of the format is not configurable. */
    ORDER_NUMBER_PREFIX: z
      .string()
      .regex(/^[A-Z]{2,4}$/, 'Two to four capital letters, as in SG')
      .default('SG'),

    /**
     * Whether this deployment takes money.
     *
     * `false` is a shop with no till: `POST /api/webhooks/stripe` is **not registered at all**
     * and the three keys below are not required. It exists because `POST /api/checkout/intent`
     * does not (D-27), so a deployment without a Stripe account can serve a complete, indexable
     * catalogue - and the alternative people reach for, putting the `.env.example` placeholders
     * in a production file, is a full compromise of the order pipeline. See D-51.
     *
     * Default `true`: an operator who simply forgot to set the keys gets a loud refusal, and one
     * who means to launch without a checkout has to say so.
     */
    PAYMENTS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),

    STRIPE_SECRET_KEY: z.string().default(''),
    STRIPE_WEBHOOK_SECRET: z.string().default(''),
    /**
     * Read under its `VITE_` name because the storefront needs the same value at build time
     * and the API hands it to the client in the checkout response. Two copies of one key is
     * one copy too many, and the copy that drifts is always the one nobody is looking at.
     */
    VITE_STRIPE_PUBLISHABLE_KEY: z.string().default(''),
    STRIPE_TAX_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),

    /**
     * Mail. Locally this is Mailpit, which accepts anything and delivers nowhere - exactly
     * what you want when a test suite sends a hundred order confirmations.
     */
    SMTP_HOST: z.string().min(1).default('127.0.0.1'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    /** Empty locally: Mailpit wants no credentials, and sending an empty user breaks auth. */
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),

    MAIL_FROM_NAME: z.string().min(1).default('SilkGrain'),
    MAIL_FROM_ADDRESS: z.string().email(),
    MAIL_REPLY_TO: z.string().email().or(z.literal('')).default(''),

    /**
     * Object storage for product images. Locally MinIO, in production any S3-compatible endpoint.
     *
     * `S3_PUBLIC_URL` is separate from `S3_ENDPOINT` on purpose: the API talks to the bucket over
     * one address and the browser fetches the finished image over another. Locally they happen to
     * be the same host; in production the endpoint is internal and the public URL is a CDN.
     * `S3_FORCE_PATH_STYLE` is true for MinIO and false for most clouds, which is why it is a knob.
     */
    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    S3_PUBLIC_URL: z.string().url(),
    // `MAIL_OPS_ADDRESS` is in `.env.example` and deliberately absent here: nothing reads it
    // until Phase 6 sends the wholesale notice, and this file lists only what the code reads.
  })
  .superRefine((value, ctx) => {
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'Must differ from JWT_ACCESS_SECRET, or a leaked access key can mint refreshes',
      });
    }
    if (value.NODE_ENV === 'production' && !value.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'Must be true in production - the refresh cookie would otherwise travel in clear',
      });
    }

    // With payments off nothing reads these, and the webhook route the secret protects is never
    // registered - so there is nothing to check and nothing to forge against.
    if (value.PAYMENTS_ENABLED) {
      const STRIPE_KEYS = [
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'VITE_STRIPE_PUBLISHABLE_KEY',
      ] as const;

      for (const key of STRIPE_KEYS) {
        if (value[key].length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message:
              'Required while PAYMENTS_ENABLED is true. Set PAYMENTS_ENABLED=false to ' +
              'run the shop as a catalogue with no checkout.',
          });
        }
      }

      // Development boots on the placeholders from `.env.example`, because everything except
      // the two calls that reach Stripe works without a real account. A deployment that took
      // an order and only then discovered its keys were fictional is the failure worth
      // preventing, so production refuses them outright.
      //
      // This is not bureaucracy: the webhook verifies with local HMAC against
      // STRIPE_WEBHOOK_SECRET, and `whsec_replace_me` is published in this repository. A
      // production API holding it would accept a forged `payment_intent.succeeded` from anyone
      // who can read GitHub - marking orders paid, decrementing stock and sending receipts.
      if (value.NODE_ENV === 'production') {
        for (const key of STRIPE_KEYS) {
          if (value[key].includes('replace_me')) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: 'Still the placeholder from .env.example',
            });
          }
        }
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
