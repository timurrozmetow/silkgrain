import type { Config } from 'tailwindcss';

import {
  breakpoint,
  color,
  font,
  gutter,
  layout,
  motion,
  radius,
  shadow,
  space,
  text,
  touch,
  zIndex,
} from './tokens';

/**
 * Tailwind preset generated from the design tokens.
 *
 * Apps consume it via `presets: [silkgrainPreset]`, so a token change lands in every
 * utility class without anyone re-typing a hex value.
 */
export const silkgrainPreset = {
  content: [],
  theme: {
    // Max-width breakpoints, matching the responsive handoff. Tailwind's own scale is
    // replaced rather than extended so nobody reaches for a breakpoint the design has no
    // rules for.
    screens: {
      tablet: { max: breakpoint.tablet },
      mobile: { max: breakpoint.mobile },
    },
    extend: {
      colors: {
        green: {
          DEFAULT: color.green,
          hover: color.greenHover,
          deep: color.greenDeep,
          footer: color.greenFooter,
          muted: color.greenMuted,
        },
        sage: {
          DEFAULT: color.sage,
          light: color.sageLight,
          bg: color.sageBg,
        },
        gold: {
          DEFAULT: color.gold,
          dark: color.goldDark,
          soft: color.goldSoft,
          pale: color.goldPale,
          bg: color.goldBg,
          notice: color.goldNotice,
        },
        parchment: color.parchment,
        surface: {
          DEFAULT: color.surface,
          warm: color.surfaceWarm,
          alt: color.surfaceAlt,
        },
        ink: {
          DEFAULT: color.ink,
          soft: color.inkSoft,
        },
        body: {
          DEFAULT: color.body,
          muted: color.bodyMuted,
        },
        muted: {
          DEFAULT: color.muted,
          soft: color.mutedSoft,
        },
        label: color.label,
        line: {
          DEFAULT: color.border,
          soft: color.borderSoft,
          warm: color.borderWarm,
        },
        terracotta: {
          DEFAULT: color.terracotta,
          bg: color.terracottaBg,
        },
        neutralChip: color.neutralBg,
        ondeep: {
          DEFAULT: color.onDeep,
          soft: color.onDeepSoft,
          muted: color.onDeepMuted,
          faint: color.onDeepFaint,
          nav: color.onDeepNav,
        },
        onfooter: {
          DEFAULT: color.onFooter,
          muted: color.onFooterMuted,
        },
        admin: {
          bg: color.adminBg,
          border: color.adminBorder,
          line: color.adminLine,
          header: color.adminHeaderBg,
          muted: color.adminMuted,
        },
      },

      fontFamily: {
        display: [font.display],
        serif: [font.serif],
        sans: [font.body],
        mono: [font.mono],
      },

      fontSize: Object.fromEntries(
        Object.entries(text).map(([name, entry]) => [
          name,
          [entry.size, { lineHeight: entry.lineHeight, letterSpacing: entry.tracking }],
        ]),
      ),

      spacing: space,
      borderRadius: radius,
      boxShadow: shadow,
      zIndex: Object.fromEntries(Object.entries(zIndex).map(([k, v]) => [k, String(v)])),

      maxWidth: {
        container: layout.container,
        'container-narrow': layout.containerNarrow,
      },
      padding: {
        gutter: gutter.desktop,
        'gutter-tablet': gutter.tablet,
        'gutter-mobile': gutter.mobile,
      },
      minHeight: {
        touch: touch.minControlSize,
      },
      minWidth: {
        touch: touch.minControlSize,
        'admin-table': '720px',
      },
      width: {
        drawer: layout.drawerWidth,
        'admin-aside': layout.adminAside,
        'filter-sidebar': layout.filterSidebar,
        'account-sidebar': layout.accountSidebar,
      },
      height: {
        header: layout.headerHeight,
        announcement: layout.announcementHeight,
        'admin-header': layout.adminHeader,
      },

      transitionDuration: motion.duration,
      transitionTimingFunction: motion.easing,

      keyframes: {
        // Named after the mockup's own animations so the mapping stays obvious.
        sgUp: {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        sgFloat: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        sgFloatB: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(8px)' },
        },
        sgGrow: {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
        sgPop: {
          '0%': { opacity: '0', transform: 'scale(.82)' },
          '60%': { transform: 'scale(1.05)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        sgShimmer: {
          from: { backgroundPosition: '-280px 0' },
          to: { backgroundPosition: '280px 0' },
        },
      },
      animation: {
        up: `sgUp ${motion.duration.hero} ease both`,
        float: 'sgFloat 5s ease-in-out infinite',
        floatB: 'sgFloatB 6s ease-in-out infinite',
        grow: `sgGrow ${motion.duration.hero} ${motion.easing.standard} both`,
        pop: `sgPop ${motion.duration.slow} ${motion.easing.standard} both`,
        shimmer: 'sgShimmer 1.4s linear infinite',
      },
    },
  },
} satisfies Config;

export default silkgrainPreset;
