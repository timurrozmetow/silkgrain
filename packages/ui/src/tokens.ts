import { AA_NON_TEXT, AA_NORMAL, type Hex } from './color';

/**
 * SilkGrain design tokens.
 *
 * Extracted from `silkgrain-design-prompt/project/SilkGrain Premium.dc.html`, which is the
 * authoritative mockup. Nine values differ from the raw mockup because they failed WCAG
 * 1.4.3 at their real size; each one moved on lightness only, so hue and saturation are
 * untouched and the change is barely perceptible. `CONTRAST_PAIRS` below documents every
 * combination the mockup actually uses and `tokens.test.ts` enforces it.
 */
export const color = {
  // --- brand green -------------------------------------------------------------------
  /** Primary. CTAs, links, prices, the "silk" half of the wordmark. */
  green: '#0E6B4A',
  /** Primary hover. */
  greenHover: '#10815A',
  /** Dark panels: announcement bar, wholesale banner, admin sidebar, subscribe card. */
  greenDeep: '#0B3D2C',
  /** Footer, one step deeper than `greenDeep`. */
  greenFooter: '#0A2E21',
  /** Positive state: in stock, free shipping. Mockup #4C7A5A, darkened for the sage chip. */
  greenMuted: '#497557',
  /** Icon green. Non-text use only. */
  sage: '#64806F',
  /** Muted green for captions on dark panels. */
  sageLight: '#9DAE97',
  /** Tint behind positive chips. */
  sageBg: '#E7F0E9',

  // --- brand gold --------------------------------------------------------------------
  /**
   * Accent. Fills, borders, stars, the diamond marker, the "grain" half of the wordmark.
   * Deliberately NOT darkened: at 2.2:1 against parchment it can never be text on a light
   * surface, and on a gold fill the text colour is `greenDeep` (5.45:1), never white.
   */
  gold: '#D3A73B',
  /** Eyebrow labels and micro-copy in gold. Mockup #8F6A14, darkened to clear surfaceAlt. */
  goldDark: '#846112',
  /** Gold for text on dark panels. */
  goldSoft: '#E9C877',
  /** Warm tint. */
  goldPale: '#F1E9DA',
  /** Tint behind warning chips. */
  goldBg: '#F1E7D4',
  /** Tint behind the wholesale notice. */
  goldNotice: '#FBF6EA',

  // --- surfaces ----------------------------------------------------------------------
  /** Page background. */
  parchment: '#F3F0E8',
  /** Card background. */
  surface: '#FCFAF4',
  /** Light buttons on dark panels. */
  surfaceWarm: '#FBF6EC',
  /** Banded sections. */
  surfaceAlt: '#E9E5D7',
  white: '#FFFFFF',

  // --- text --------------------------------------------------------------------------
  /** Headings. */
  ink: '#23231E',
  /** Near-black, used by the FDA nutrition label which must stay high-contrast. */
  inkSoft: '#1E1E1E',
  /** Body copy, nav. */
  body: '#3A352B',
  /** Form and tab copy. */
  bodyMuted: '#4A4334',
  /** Secondary text. */
  muted: '#6B6456',
  /**
   * One step lighter than `muted`. Replaces the mockup's two near-identical tones
   * #8A7F68 and #9A8F78, which both failed and were a third of a step apart.
   */
  mutedSoft: '#766C58',
  /** Uppercase micro-labels, e.g. the category line on a product card. Mockup #A2906F. */
  label: '#827154',

  // --- borders -----------------------------------------------------------------------
  border: '#D9D0C0',
  borderSoft: '#E4E0D1',
  borderWarm: '#E4DAC6',

  // --- status ------------------------------------------------------------------------
  /** Error, sale badge, wishlist hover, destructive. Mockup #B85C38. */
  terracotta: '#A85433',
  /** Tint behind error and sale chips. */
  terracottaBg: '#FBEAE3',
  /** Tint behind neutral chips. */
  neutralBg: '#EEE9DD',

  // --- text on dark panels -----------------------------------------------------------
  onDeep: '#CFDCD3',
  onDeepSoft: '#C7D2C0',
  onDeepMuted: '#9DAE97',
  onDeepFaint: '#93A89A',
  onDeepNav: '#A9BBA4',
  onFooter: '#C9D3C2',
  onFooterMuted: '#8A9A85',

  // --- admin -------------------------------------------------------------------------
  adminBg: '#EEF1EC',
  adminBorder: '#E2E5DF',
  adminLine: '#EEF0EB',
  adminHeaderBg: '#FAFBF8',
  /** Table headers and placeholders in the admin. Mockup #9AA295. */
  adminMuted: '#687063',
} as const satisfies Record<string, Hex>;

export const font = {
  /** Hero headlines, product names, card titles. Weights 500/600/700, italic 500. */
  display: "'Cormorant Garamond', Georgia, serif",
  /** Section headings, admin headings. Weight 400 only - the family ships one weight. */
  serif: "'DM Serif Display', Georgia, serif",
  /** All UI. Weights 400/500/600/700. */
  body: "'Inter', system-ui, -apple-system, sans-serif",
  /** Prices, counters, SKUs, eyebrows - anything numeric or tabular. Weights 400/500. */
  mono: "'DM Mono', ui-monospace, SFMono-Regular, monospace",
} as const;

/** Type scale, taken from the sizes the mockup actually uses. */
export const text = {
  hero: { size: '76px', lineHeight: '1.03', tracking: '-0.02em', family: 'display', weight: 500 },
  h1: { size: '48px', lineHeight: '1.05', tracking: '0', family: 'display', weight: 600 },
  h1Serif: { size: '42px', lineHeight: '1.06', tracking: '0', family: 'serif', weight: 400 },
  h2: { size: '40px', lineHeight: '1', tracking: '0', family: 'serif', weight: 400 },
  h3: { size: '26px', lineHeight: '1.15', tracking: '0', family: 'display', weight: 600 },
  cardTitle: { size: '22px', lineHeight: '1.12', tracking: '0', family: 'display', weight: 600 },
  bodyLg: { size: '17.5px', lineHeight: '1.7', tracking: '0', family: 'body', weight: 400 },
  body: { size: '16px', lineHeight: '1.65', tracking: '0', family: 'body', weight: 400 },
  bodySm: { size: '14px', lineHeight: '1.5', tracking: '0', family: 'body', weight: 400 },
  caption: { size: '13px', lineHeight: '1.45', tracking: '0', family: 'body', weight: 400 },
  eyebrow: { size: '12px', lineHeight: '1', tracking: '0.18em', family: 'mono', weight: 400 },
  eyebrowWide: { size: '11.5px', lineHeight: '1', tracking: '0.26em', family: 'mono', weight: 400 },
  microLabel: { size: '10px', lineHeight: '1', tracking: '0.1em', family: 'body', weight: 600 },
  priceLg: { size: '34px', lineHeight: '1', tracking: '0', family: 'mono', weight: 500 },
  price: { size: '21px', lineHeight: '1', tracking: '0', family: 'mono', weight: 500 },
} as const;

export const radius = {
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '18px',
  pill: '999px',
  /** The hero CTA and drawer buttons use a near-square corner. */
  sharp: '3px',
} as const;

export const shadow = {
  card: '0 2px 12px rgba(14,58,42,0.07)',
  cardHover: '0 18px 38px rgba(14,58,42,0.18)',
  panel: '0 6px 24px rgba(14,58,42,0.08)',
  hero: '0 20px 50px rgba(14,58,42,0.15)',
  heroImage: '0 30px 70px rgba(14,58,42,0.18)',
  mega: '0 30px 60px rgba(11,46,33,0.12)',
  drawer: '-18px 0 50px rgba(11,46,33,0.18)',
  modal: '0 40px 90px rgba(11,46,33,0.32)',
  focus: '0 0 0 3px rgba(74,140,92,0.15)',
} as const;

export const layout = {
  container: '1280px',
  containerNarrow: '1180px',
  gutter: '28px',
  headerHeight: '74px',
  announcementHeight: '33px',
  adminAside: '248px',
  adminHeader: '68px',
  filterSidebar: '260px',
  drawerWidth: '430px',
  accountSidebar: '280px',
} as const;

/** 4px base scale, matching the spacing values used across the mockup. */
export const space = {
  0: '0',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  7: '28px',
  8: '32px',
  10: '40px',
  12: '48px',
  14: '56px',
  16: '64px',
  20: '80px',
  24: '96px',
} as const;

export const motion = {
  duration: {
    fast: '180ms',
    base: '200ms',
    slow: '280ms',
    image: '550ms',
    hero: '700ms',
    drawer: '500ms',
  },
  easing: {
    /** The mockup's default for lifts, drawers and card hovers. */
    standard: 'cubic-bezier(.22,1,.36,1)',
    /** Hero carousel slide. */
    hero: 'cubic-bezier(.65,0,.35,1)',
    linear: 'linear',
  },
} as const;

export const zIndex = {
  header: 50,
  overlay: 90,
  drawer: 95,
  search: 96,
  modal: 97,
  toast: 98,
} as const;

/**
 * Two breakpoints, straight from the responsive handoff - not the usual four.
 *
 * `tablet` (<= 1024px) collapses two-column sections and sidebars, drops product grids from
 * four columns to three and unpins sticky columns. `mobile` (<= 760px) goes single-column
 * everywhere except product grids, which stay two-up so the catalogue is still scannable.
 *
 * Gutters change with them: 28px desktop, 22px tablet, 16px mobile.
 */
export const breakpoint = {
  mobile: '760px',
  tablet: '1024px',
} as const;

export const gutter = {
  desktop: '28px',
  tablet: '22px',
  mobile: '16px',
} as const;

/**
 * Touch rules the responsive handoff calls out explicitly.
 * `minControlSize` is the 44px touch target; `minInputFontSize` is what stops iOS Safari
 * zooming the page when a field takes focus.
 */
export const touch = {
  minControlSize: '44px',
  minInputFontSize: '16px',
} as const;

// ---------------------------------------------------------------------------------------
// Contrast contract
// ---------------------------------------------------------------------------------------

export interface ContrastPair {
  /** Where this combination appears, so a failure points at a screen. */
  readonly usage: string;
  readonly foreground: Hex;
  readonly background: Hex;
  readonly level: number;
}

/**
 * Every foreground/background combination the mockup uses. Enforced by `tokens.test.ts`.
 * Adding a new colour combination to a component means adding it here first.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  // text on light surfaces
  { usage: 'headings', foreground: color.ink, background: color.parchment, level: AA_NORMAL },
  {
    usage: 'headings on cards',
    foreground: color.ink,
    background: color.surface,
    level: AA_NORMAL,
  },
  {
    usage: 'headings on bands',
    foreground: color.ink,
    background: color.surfaceAlt,
    level: AA_NORMAL,
  },
  {
    usage: 'nutrition label',
    foreground: color.inkSoft,
    background: color.white,
    level: AA_NORMAL,
  },
  { usage: 'nav and body', foreground: color.body, background: color.parchment, level: AA_NORMAL },
  { usage: 'body on cards', foreground: color.body, background: color.surface, level: AA_NORMAL },
  {
    usage: 'body on bands',
    foreground: color.body,
    background: color.surfaceAlt,
    level: AA_NORMAL,
  },
  {
    usage: 'form and tab copy',
    foreground: color.bodyMuted,
    background: color.surface,
    level: AA_NORMAL,
  },
  {
    usage: 'secondary text',
    foreground: color.muted,
    background: color.parchment,
    level: AA_NORMAL,
  },
  {
    usage: 'secondary on cards',
    foreground: color.muted,
    background: color.surface,
    level: AA_NORMAL,
  },
  {
    usage: 'secondary on bands',
    foreground: color.muted,
    background: color.surfaceAlt,
    level: AA_NORMAL,
  },
  { usage: 'captions', foreground: color.mutedSoft, background: color.parchment, level: AA_NORMAL },
  {
    usage: 'captions on cards',
    foreground: color.mutedSoft,
    background: color.surface,
    level: AA_NORMAL,
  },
  {
    usage: 'card category label',
    foreground: color.label,
    background: color.surface,
    level: AA_NORMAL,
  },
  { usage: 'eyebrow', foreground: color.goldDark, background: color.parchment, level: AA_NORMAL },
  {
    usage: 'eyebrow on cards',
    foreground: color.goldDark,
    background: color.surface,
    level: AA_NORMAL,
  },
  {
    usage: 'eyebrow on bands',
    foreground: color.goldDark,
    background: color.surfaceAlt,
    level: AA_NORMAL,
  },

  // accents on light
  {
    usage: 'links and prices',
    foreground: color.green,
    background: color.parchment,
    level: AA_NORMAL,
  },
  {
    usage: 'prices on cards',
    foreground: color.green,
    background: color.surface,
    level: AA_NORMAL,
  },
  {
    usage: 'links on bands',
    foreground: color.green,
    background: color.surfaceAlt,
    level: AA_NORMAL,
  },
  { usage: 'in stock', foreground: color.greenMuted, background: color.surface, level: AA_NORMAL },
  {
    usage: 'in-stock chip',
    foreground: color.greenMuted,
    background: color.sageBg,
    level: AA_NORMAL,
  },
  {
    usage: 'errors and reset',
    foreground: color.terracotta,
    background: color.surface,
    level: AA_NORMAL,
  },
  {
    usage: 'errors on page',
    foreground: color.terracotta,
    background: color.parchment,
    level: AA_NORMAL,
  },
  {
    usage: 'error chip',
    foreground: color.terracotta,
    background: color.terracottaBg,
    level: AA_NORMAL,
  },
  {
    usage: 'low-stock chip',
    foreground: color.goldDark,
    background: color.goldBg,
    level: AA_NORMAL,
  },
  { usage: 'draft chip', foreground: color.muted, background: color.neutralBg, level: AA_NORMAL },
  {
    usage: 'admin table headers',
    foreground: color.adminMuted,
    background: color.white,
    level: AA_NORMAL,
  },
  {
    usage: 'admin placeholders',
    foreground: color.adminMuted,
    background: color.adminBg,
    level: AA_NORMAL,
  },

  // icons: non-text, 3:1
  { usage: 'trust icons', foreground: color.sage, background: color.surface, level: AA_NON_TEXT },
  {
    usage: 'trust icons on page',
    foreground: color.sage,
    background: color.parchment,
    level: AA_NON_TEXT,
  },

  // text on accent fills
  { usage: 'primary button', foreground: color.white, background: color.green, level: AA_NORMAL },
  {
    usage: 'hero button',
    foreground: color.surfaceWarm,
    background: color.green,
    level: AA_NORMAL,
  },
  {
    usage: 'gold button and badge',
    foreground: color.greenDeep,
    background: color.gold,
    level: AA_NORMAL,
  },
  { usage: 'sale badge', foreground: color.white, background: color.terracotta, level: AA_NORMAL },
  {
    usage: 'organic badge',
    foreground: color.white,
    background: color.greenMuted,
    level: AA_NORMAL,
  },
  { usage: 'premium badge', foreground: color.white, background: color.goldDark, level: AA_NORMAL },

  // text on dark panels
  {
    usage: 'announcement bar',
    foreground: color.onDeep,
    background: color.greenDeep,
    level: AA_NORMAL,
  },
  { usage: 'gold on dark', foreground: color.gold, background: color.greenDeep, level: AA_NORMAL },
  {
    usage: 'wholesale copy',
    foreground: color.onDeepSoft,
    background: color.greenDeep,
    level: AA_NORMAL,
  },
  {
    usage: 'stat captions',
    foreground: color.onDeepMuted,
    background: color.greenDeep,
    level: AA_NORMAL,
  },
  {
    usage: 'admin sidebar labels',
    foreground: color.onDeepFaint,
    background: color.greenDeep,
    level: AA_NORMAL,
  },
  {
    usage: 'admin sidebar nav',
    foreground: color.onDeepNav,
    background: color.greenDeep,
    level: AA_NORMAL,
  },
  {
    usage: 'headings on dark',
    foreground: color.parchment,
    background: color.greenDeep,
    level: AA_NORMAL,
  },
  {
    usage: 'footer body',
    foreground: color.onFooter,
    background: color.greenFooter,
    level: AA_NORMAL,
  },
  {
    usage: 'footer links',
    foreground: color.onDeepMuted,
    background: color.greenFooter,
    level: AA_NORMAL,
  },
  {
    usage: 'footer copyright',
    foreground: color.onFooterMuted,
    background: color.greenFooter,
    level: AA_NORMAL,
  },
];
