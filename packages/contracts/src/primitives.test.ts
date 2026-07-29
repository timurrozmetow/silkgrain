import { describe, expect, it } from 'vitest';

import { Cents, Email, Phone, Slug, UsState, Zip } from './primitives';

describe('Slug', () => {
  it.each(['uzbek-devzira-rice', 'saffron-threads', 'lagman-noodle-kit'])('accepts %s', (value) => {
    expect(Slug.parse(value)).toBe(value);
  });

  it.each(['Uzbek-Devzira', 'double--hyphen', '-leading', 'trailing-', 'with space'])(
    'rejects %s',
    (value) => {
      expect(Slug.safeParse(value).success).toBe(false);
    },
  );
});

describe('Cents', () => {
  it('accepts whole cents', () => {
    expect(Cents.parse(3250)).toBe(3250);
    expect(Cents.parse(0)).toBe(0);
  });

  it('rejects fractional cents — money is never a float', () => {
    expect(Cents.safeParse(32.5).success).toBe(false);
  });

  it('rejects negative amounts', () => {
    expect(Cents.safeParse(-1).success).toBe(false);
  });
});

describe('Email', () => {
  it('trims and lowercases', () => {
    expect(Email.parse('  Hello@SilkGrain.com ')).toBe('hello@silkgrain.com');
  });

  it('rejects a malformed address', () => {
    expect(Email.safeParse('hello@').success).toBe(false);
  });
});

describe('Zip', () => {
  it.each(['77002', '77002-1234'])('accepts %s', (value) => {
    expect(Zip.parse(value)).toBe(value);
  });

  it.each(['7700', '770021', 'ABCDE'])('rejects %s', (value) => {
    expect(Zip.safeParse(value).success).toBe(false);
  });
});

describe('Phone', () => {
  it.each(['(713) 555-0148', '713-555-0148', '+1 713 555 0148', '7135550148'])(
    'accepts %s',
    (value) => {
      expect(Phone.safeParse(value).success).toBe(true);
    },
  );

  it('rejects a number that is too short', () => {
    expect(Phone.safeParse('555-0148').success).toBe(false);
  });
});

describe('UsState', () => {
  it('covers 50 states plus DC', () => {
    expect(UsState.options).toHaveLength(51);
    expect(UsState.options).toContain('TX');
    expect(UsState.options).toContain('DC');
  });
});
