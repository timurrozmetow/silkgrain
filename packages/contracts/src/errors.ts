import { z } from 'zod';

/**
 * Every error the API can return, as a closed set.
 * The client switches on `code`; `message` is for humans and may change freely.
 */
export const ErrorCode = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',

  'CART_PRICE_MISMATCH',
  'CART_ITEM_UNAVAILABLE',
  'INSUFFICIENT_STOCK',

  'PROMO_INVALID',
  'PROMO_EXPIRED',
  'PROMO_MIN_ORDER_NOT_MET',
  'PROMO_USAGE_LIMIT_REACHED',

  'PAYMENT_FAILED',
  'PAYMENT_AMOUNT_MISMATCH',
  'WEBHOOK_SIGNATURE_INVALID',

  'INTERNAL',
]);

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
    /** Correlates the response with a line in the structured log. */
    requestId: z.string().optional(),
  }),
});

export type ErrorCode = z.infer<typeof ErrorCode>;
export type ApiError = z.infer<typeof ApiError>;

/** Default HTTP status per code, so handlers never hand-pick a mismatching one. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,

  CART_PRICE_MISMATCH: 422,
  CART_ITEM_UNAVAILABLE: 422,
  INSUFFICIENT_STOCK: 422,

  PROMO_INVALID: 422,
  PROMO_EXPIRED: 422,
  PROMO_MIN_ORDER_NOT_MET: 422,
  PROMO_USAGE_LIMIT_REACHED: 422,

  PAYMENT_FAILED: 402,
  PAYMENT_AMOUNT_MISMATCH: 409,
  WEBHOOK_SIGNATURE_INVALID: 400,

  INTERNAL: 500,
};
