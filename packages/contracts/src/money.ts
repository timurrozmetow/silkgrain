/**
 * Money as an immutable value object over integer cents.
 *
 * This file is the only place in the repository allowed to construct an
 * `Intl.NumberFormat`; everywhere else an ESLint rule forbids it, so currency formatting
 * cannot drift into a component. It is also deliberately free of Zod, so the browser can
 * import `@silkgrain/contracts/money` without pulling the schema layer into the bundle.
 *
 * Every amount is a whole number of cents. Floats never enter: `0.1 + 0.2` is the reason
 * the platform stores `BIGINT` cents in MySQL and transports plain integers over the wire.
 */

export type CurrencyCode = 'USD';

const MINOR_UNITS = 100;
const BASIS_POINTS = 10_000;

/**
 * Round half to even ("banker's rounding").
 *
 * Half-up would bias every tax and percentage discount upward by a fraction of a cent, and
 * across thousands of order lines that becomes a real, visible discrepancy against Stripe.
 */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export class Money {
  readonly cents: number;
  readonly currency: CurrencyCode;

  private constructor(cents: number, currency: CurrencyCode) {
    if (!Number.isSafeInteger(cents)) {
      throw new RangeError(
        `Money: expected a safe integer number of cents, received ${String(cents)}`,
      );
    }
    this.cents = cents;
    this.currency = currency;
    Object.freeze(this);
  }

  static fromCents(cents: number, currency: CurrencyCode = 'USD'): Money {
    return new Money(cents, currency);
  }

  static zero(currency: CurrencyCode = 'USD'): Money {
    return new Money(0, currency);
  }

  /**
   * Parses a human-authored amount such as `"32.50"`, `"$7.99"` or `"129"`.
   *
   * Only for seeds, admin forms and fixtures. At runtime money arrives as cents already —
   * nothing in a request body is ever parsed through here.
   */
  static parse(input: string, currency: CurrencyCode = 'USD'): Money {
    const match = /^-?\$?\s*(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
    if (!match) {
      throw new RangeError(`Money.parse: cannot read "${input}" as an amount`);
    }
    const [, whole = '0', fraction = '0'] = match;
    const magnitude = Number(whole) * MINOR_UNITS + Number(fraction.padEnd(2, '0'));
    return new Money(input.trim().startsWith('-') ? -magnitude : magnitude, currency);
  }

  /**
   * Converts a JavaScript number of dollars. Rejects anything with sub-cent precision
   * rather than rounding it away silently — a price of `14.999` is a data-entry bug.
   */
  static fromAmount(amount: number, currency: CurrencyCode = 'USD'): Money {
    const cents = amount * MINOR_UNITS;
    const rounded = Math.round(cents);
    if (Math.abs(cents - rounded) > 1e-6) {
      throw new RangeError(`Money.fromAmount: ${String(amount)} has sub-cent precision`);
    }
    return new Money(rounded, currency);
  }

  static sum(values: readonly Money[], currency: CurrencyCode = 'USD'): Money {
    return values.reduce<Money>((total, value) => total.add(value), Money.zero(currency));
  }

  /**
   * A runtime guard the type system currently makes redundant.
   *
   * `CurrencyCode` is a single literal today, so TypeScript proves this can never fire - which
   * is exactly why the locals below are widened to `string`. The day a second currency is
   * added, this check is already in place and every mixed-currency addition throws instead of
   * quietly producing a number that means nothing.
   */
  private assertSameCurrency(other: Money): void {
    const mine: string = this.currency;
    const theirs: string = other.currency;
    if (mine !== theirs) {
      throw new TypeError(`Money: currency mismatch, ${mine} against ${theirs}`);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents + other.cents, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents - other.cents, this.currency);
  }

  /**
   * Multiplies by a line quantity. Integers only — a fractional multiplier is a percentage
   * or a share, and those go through `basisPoints` or `allocate` so the rounding is explicit.
   */
  multiply(quantity: number): Money {
    if (!Number.isSafeInteger(quantity)) {
      throw new RangeError(
        `Money.multiply: quantity must be a whole number, received ${String(quantity)}`,
      );
    }
    return new Money(this.cents * quantity, this.currency);
  }

  /**
   * Applies a rate expressed in basis points: 825 bp is 8.25 %.
   *
   * Basis points rather than a percentage because tax rates and discounts are configured as
   * integers (`DEFAULT_TAX_RATE_BASIS_POINTS=825`), and an integer numerator keeps the
   * arithmetic exact until the single rounding step at the end.
   */
  basisPoints(rate: number): Money {
    if (!Number.isSafeInteger(rate)) {
      throw new RangeError(
        `Money.basisPoints: rate must be a whole number, received ${String(rate)}`,
      );
    }
    return new Money(roundHalfEven((this.cents * rate) / BASIS_POINTS), this.currency);
  }

  /** Convenience wrapper over `basisPoints` for percentages with at most two decimals. */
  percentage(percent: number): Money {
    const rate = percent * MINOR_UNITS;
    const rounded = Math.round(rate);
    if (Math.abs(rate - rounded) > 1e-6) {
      throw new RangeError(`Money.percentage: ${String(percent)}% is finer than one basis point`);
    }
    return this.basisPoints(rounded);
  }

  /**
   * Splits the amount across the given weights so the parts add back up to the whole.
   *
   * A 12 % discount on a three-item set has to land on the individual lines such that the
   * lines still sum to the order total. Flooring each share and handing the leftover cents
   * out one at a time is what makes that exact; without it the missing cent surfaces later
   * as a reconciliation failure against the payment provider.
   */
  allocate(weights: readonly number[]): Money[] {
    if (weights.length === 0) {
      throw new RangeError('Money.allocate: needs at least one weight');
    }
    if (weights.some((weight) => weight < 0)) {
      throw new RangeError('Money.allocate: weights must not be negative');
    }
    if (this.cents < 0) {
      throw new RangeError('Money.allocate: allocate a magnitude, not a negative amount');
    }

    const total = weights.reduce((accumulator, weight) => accumulator + weight, 0);
    if (total <= 0) {
      throw new RangeError('Money.allocate: weights must sum to a positive number');
    }

    const shares = weights.map((weight) => Math.floor((this.cents * weight) / total));
    let remainder = this.cents - shares.reduce((accumulator, share) => accumulator + share, 0);

    // Largest fractional part first would be fairer still, but round-robin from the top is
    // what every payment ledger does and it keeps the result stable for a given input.
    for (let index = 0; remainder > 0; index = (index + 1) % shares.length) {
      shares[index] = (shares[index] ?? 0) + 1;
      remainder -= 1;
    }

    return shares.map((share) => new Money(share, this.currency));
  }

  negate(): Money {
    return new Money(-this.cents, this.currency);
  }

  abs(): Money {
    return this.cents < 0 ? this.negate() : this;
  }

  isZero(): boolean {
    return this.cents === 0;
  }

  isNegative(): boolean {
    return this.cents < 0;
  }

  equals(other: Money): boolean {
    const mine: string = this.currency;
    const theirs: string = other.currency;
    return mine === theirs && this.cents === other.cents;
  }

  greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents > other.cents;
  }

  greaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents >= other.cents;
  }

  lessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents < other.cents;
  }

  /** Clamps at zero. Used wherever a discount must not turn an order into a payout. */
  clampToZero(): Money {
    return this.cents < 0 ? Money.zero(this.currency) : this;
  }

  /**
   * `"$32.50"`. The one legal `Intl.NumberFormat` in the codebase; formatters are cached
   * because constructing one costs roughly as much as formatting a hundred values.
   */
  format(locale = 'en-US'): string {
    return formatterFor(locale, this.currency).format(this.cents / MINOR_UNITS);
  }

  /** Dollars as a number. For Stripe's API and for CSV export only, never for arithmetic. */
  toAmount(): number {
    return this.cents / MINOR_UNITS;
  }

  toJSON(): { amount: number; currency: CurrencyCode } {
    return { amount: this.cents, currency: this.currency };
  }

  toString(): string {
    return this.format();
  }
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(locale: string, currency: CurrencyCode): Intl.NumberFormat {
  const key = `${locale}:${currency}`;
  const cached = formatters.get(key);
  if (cached) return cached;

  // eslint-disable-next-line no-restricted-syntax -- this is the single place the rule points at
  const created = new Intl.NumberFormat(locale, { style: 'currency', currency });
  formatters.set(key, created);
  return created;
}

/** Shorthand for the common case. `usd(1499).format()` reads better than the constructor. */
export function usd(cents: number): Money {
  return Money.fromCents(cents, 'USD');
}
