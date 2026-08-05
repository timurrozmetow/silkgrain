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

    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
    /**
     * Read under its `VITE_` name because the storefront needs the same value at build time
     * and the API hands it to the client in the checkout response. Two copies of one key is
     * one copy too many, and the copy that drifts is always the one nobody is looking at.
     */
    VITE_STRIPE_PUBLISHABLE_KEY: z.string().min(1),
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

    // Development boots on the placeholders from `.env.example`, because everything except
    // the two calls that reach Stripe works without a real account. A deployment that took
    // an order and only then discovered its keys were fictional is the failure worth
    // preventing, so production refuses them outright.
    if (value.NODE_ENV === 'production') {
      for (const key of [
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'VITE_STRIPE_PUBLISHABLE_KEY',
      ] as const) {
        if (value[key].includes('replace_me')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: 'Still the placeholder from .env.example',
          });
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
