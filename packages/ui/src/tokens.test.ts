import { describe, expect, it } from 'vitest';

import { AA_NON_TEXT, AA_NORMAL, contrastRatio, luminance } from './color';
import { CONTRAST_PAIRS, color, motion, space, text } from './tokens';

describe('contrast contract', () => {
  it.each(CONTRAST_PAIRS)(
    '$usage: $foreground on $background meets $level:1',
    ({ foreground, background, level }) => {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(level);
    },
  );

  it('covers every text colour token', () => {
    const textTokens = [
      color.ink,
      color.inkSoft,
      color.body,
      color.bodyMuted,
      color.muted,
      color.mutedSoft,
      color.label,
      color.goldDark,
      color.green,
      color.greenMuted,
      color.terracotta,
      color.adminMuted,
    ];
    const used = new Set(CONTRAST_PAIRS.map((pair) => pair.foreground));
    for (const token of textTokens) {
      expect(used, `${token} has no documented background`).toContain(token);
    }
  });
});

describe('gold is never text on a light surface', () => {
  // Gold is the brand accent and is kept at its mockup value, which means it can only ever
  // be a fill, a border or a decorative glyph. This test is what stops it drifting into copy.
  it.each([color.parchment, color.surface, color.surfaceAlt, color.white])(
    'stays below the text threshold on %s, so it must not be used for text there',
    (background) => {
      expect(contrastRatio(color.gold, background)).toBeLessThan(AA_NON_TEXT);
    },
  );

  it('carries greenDeep, not white, when used as a fill', () => {
    expect(contrastRatio(color.greenDeep, color.gold)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrastRatio(color.white, color.gold)).toBeLessThan(AA_NORMAL);
  });
});

describe('muted scale', () => {
  it('darkens monotonically from mutedSoft to ink', () => {
    const scale = [color.mutedSoft, color.muted, color.bodyMuted, color.body, color.ink];
    const luminances = scale.map(luminance);
    for (let i = 1; i < luminances.length; i++) {
      expect(luminances[i]!).toBeLessThan(luminances[i - 1]!);
    }
  });

  it('keeps a perceptible gap between adjacent steps', () => {
    // Two tones a hair apart are two tones nobody can tell apart; the mockup had three.
    expect(contrastRatio(color.mutedSoft, color.muted)).toBeGreaterThan(1.05);
    expect(contrastRatio(color.muted, color.bodyMuted)).toBeGreaterThan(1.15);
  });
});

describe('scales', () => {
  it('keeps spacing on a 4px grid', () => {
    for (const value of Object.values(space)) {
      const px = Number.parseInt(value, 10);
      expect(px % 4, `${value} is off the 4px grid`).toBe(0);
    }
  });

  it('orders the type scale from hero down to micro labels', () => {
    const sizes = [text.hero, text.h1, text.h2, text.cardTitle, text.body, text.microLabel].map(
      (entry) => Number.parseFloat(entry.size),
    );
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!).toBeLessThan(sizes[i - 1]!);
    }
  });

  it('expresses every duration in milliseconds', () => {
    for (const value of Object.values(motion.duration)) {
      expect(value).toMatch(/^\d+ms$/);
    }
  });
});
