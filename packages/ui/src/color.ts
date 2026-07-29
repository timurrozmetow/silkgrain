/**
 * WCAG 2.1 contrast maths.
 *
 * Kept in the design system rather than in a build script so the palette and the rule that
 * validates it cannot drift apart: `tokens.test.ts` runs these on every commit.
 */

/** Minimum contrast for text below 24px (or below 18.66px bold). */
export const AA_NORMAL = 4.5;

/** Minimum contrast for text at 24px+, or 18.66px+ bold. */
export const AA_LARGE = 3;

/** Minimum contrast for icons, focus rings and borders that carry meaning (WCAG 1.4.11). */
export const AA_NON_TEXT = 3;

export type Hex = `#${string}`;

export function hexToRgb(hex: Hex): [number, number, number] {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    throw new RangeError(`Not a hex colour: ${hex}`);
  }
  return [r, g, b];
}

/** Relative luminance per WCAG 2.1, on the linearised sRGB channels. */
export function luminance(hex: Hex): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, from 1:1 to 21:1. Order does not matter. */
export function contrastRatio(a: Hex, b: Hex): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsContrast(a: Hex, b: Hex, level: number = AA_NORMAL): boolean {
  return contrastRatio(a, b) >= level;
}
