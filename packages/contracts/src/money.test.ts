import { describe, expect, it } from 'vitest';

import { Money, usd } from './money';

describe('Money construction', () => {
  it('rejects anything that is not a whole number of cents', () => {
    expect(() => Money.fromCents(10.5)).toThrow(RangeError);
    expect(() => Money.fromCents(Number.NaN)).toThrow(RangeError);
    expect(() => Money.fromCents(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it('is frozen, so a reference cannot be mutated behind a caller', () => {
    const price = usd(1499);
    expect(Object.isFrozen(price)).toBe(true);
    expect(price.add(usd(1)).cents).toBe(1500);
    expect(price.cents).toBe(1499);
  });

  it('parses the amounts the seed data is authored in', () => {
    expect(Money.parse('32.50').cents).toBe(3250);
    expect(Money.parse('$7.99').cents).toBe(799);
    expect(Money.parse('129').cents).toBe(12_900);
    expect(Money.parse('  59  ').cents).toBe(5900);
    expect(Money.parse('4.5').cents).toBe(450);
    expect(Money.parse('-12.25').cents).toBe(-1225);
  });

  it('refuses input it cannot read exactly', () => {
    expect(() => Money.parse('12.345')).toThrow(RangeError);
    expect(() => Money.parse('1,299.00')).toThrow(RangeError);
    expect(() => Money.parse('free')).toThrow(RangeError);
  });

  it('converts dollars but rejects sub-cent precision instead of rounding it away', () => {
    expect(Money.fromAmount(14.99).cents).toBe(1499);
    expect(Money.fromAmount(0.1).cents).toBe(10);
    expect(() => Money.fromAmount(14.999)).toThrow(RangeError);
  });
});

describe('Money arithmetic', () => {
  it('adds, subtracts and sums', () => {
    expect(usd(1499).add(usd(3250)).cents).toBe(4749);
    expect(usd(5000).subtract(usd(799)).cents).toBe(4201);
    expect(Money.sum([usd(1499), usd(3250), usd(850)]).cents).toBe(5599);
    expect(Money.sum([]).cents).toBe(0);
  });

  it('multiplies by a line quantity only', () => {
    expect(usd(3250).multiply(2).cents).toBe(6500);
    expect(usd(3250).multiply(0).cents).toBe(0);
    expect(() => usd(3250).multiply(1.5)).toThrow(RangeError);
  });

  it('goes negative on subtraction and clamps only when asked', () => {
    const overdrawn = usd(1000).subtract(usd(2500));
    expect(overdrawn.cents).toBe(-1500);
    expect(overdrawn.isNegative()).toBe(true);
    expect(overdrawn.abs().cents).toBe(1500);
    expect(overdrawn.clampToZero().cents).toBe(0);
    expect(usd(500).clampToZero().cents).toBe(500);
  });
});

describe('Money rates', () => {
  it('applies basis points, the form tax rates are configured in', () => {
    // 8.25 % Texas sales tax on $55.99.
    expect(usd(5599).basisPoints(825).cents).toBe(462);
    expect(usd(10_000).basisPoints(1000).cents).toBe(1000);
    expect(usd(0).basisPoints(825).cents).toBe(0);
  });

  it('rounds half to even, so repeated rates do not drift upward', () => {
    // 50 bp of 5 cents is exactly 0.25 -> below the half, rounds down.
    expect(usd(5).basisPoints(5000).cents).toBe(2);
    // Exactly .5 rounds to the even neighbour in both directions.
    expect(usd(5).basisPoints(1000).cents).toBe(0); // 0.5 -> 0
    expect(usd(15).basisPoints(1000).cents).toBe(2); // 1.5 -> 2
    expect(usd(25).basisPoints(1000).cents).toBe(2); // 2.5 -> 2
    expect(usd(35).basisPoints(1000).cents).toBe(4); // 3.5 -> 4
  });

  it('accepts a percentage down to one basis point and refuses finer', () => {
    expect(usd(5599).percentage(8.25).cents).toBe(462);
    expect(usd(5599).percentage(12).cents).toBe(672);
    expect(() => usd(5599).percentage(8.255)).toThrow(RangeError);
  });
});

describe('Money.allocate', () => {
  it('never loses or invents a cent', () => {
    const shares = usd(100).allocate([1, 1, 1]);
    expect(shares.map((share) => share.cents)).toEqual([34, 33, 33]);
    expect(Money.sum(shares).cents).toBe(100);
  });

  it('splits a set discount across lines in proportion to their value', () => {
    // "The Plov Set": $32.50 + $13.50 + $8.50 = $54.50, sold at $49.00 -> $5.50 off.
    const lines = [usd(3250), usd(1350), usd(850)];
    const discount = usd(550);
    const shares = discount.allocate(lines.map((line) => line.cents));

    expect(Money.sum(shares).equals(discount)).toBe(true);
    const discounted = lines.map((line, index) => line.subtract(shares[index] ?? Money.zero()));
    expect(Money.sum(discounted).cents).toBe(4900);
  });

  it('is stable and handles zero weights and a single line', () => {
    expect(
      usd(100)
        .allocate([1, 1, 1])
        .map((share) => share.cents),
    ).toEqual(
      usd(100)
        .allocate([1, 1, 1])
        .map((share) => share.cents),
    );
    expect(
      usd(999)
        .allocate([3])
        .map((share) => share.cents),
    ).toEqual([999]);
    expect(
      usd(10)
        .allocate([1, 0, 1])
        .map((share) => share.cents),
    ).toEqual([5, 0, 5]);
  });

  it('rejects input it cannot split honestly', () => {
    expect(() => usd(100).allocate([])).toThrow(RangeError);
    expect(() => usd(100).allocate([0, 0])).toThrow(RangeError);
    expect(() => usd(100).allocate([1, -1])).toThrow(RangeError);
    expect(() => usd(100).subtract(usd(200)).allocate([1, 1])).toThrow(RangeError);
  });
});

describe('Money comparison and output', () => {
  it('compares', () => {
    expect(usd(1000).greaterThan(usd(999))).toBe(true);
    expect(usd(1000).greaterThanOrEqual(usd(1000))).toBe(true);
    expect(usd(999).lessThan(usd(1000))).toBe(true);
    expect(usd(1000).equals(usd(1000))).toBe(true);
    expect(usd(0).isZero()).toBe(true);
  });

  it('formats US dollars', () => {
    expect(usd(3250).format()).toBe('$32.50');
    expect(usd(0).format()).toBe('$0.00');
    expect(usd(129_900).format()).toBe('$1,299.00');
    expect(usd(-550).format()).toBe('-$5.50');
    expect(String(usd(799))).toBe('$7.99');
  });

  it('serialises as an integer plus an explicit currency', () => {
    expect(usd(3250).toJSON()).toEqual({ amount: 3250, currency: 'USD' });
    expect(JSON.parse(JSON.stringify({ total: usd(4900) }))).toEqual({
      total: { amount: 4900, currency: 'USD' },
    });
  });

  it('exposes dollars for payment providers but keeps arithmetic in cents', () => {
    expect(usd(4900).toAmount()).toBe(49);
    expect(usd(799).toAmount()).toBe(7.99);
  });
});
