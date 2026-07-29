import type { Config } from 'tailwindcss';

import silkgrainPreset from './src/tailwind-preset';

/** Storybook-only: the apps bring their own config that also scans their own sources. */
export default {
  presets: [silkgrainPreset],
  content: ['./src/**/*.{ts,tsx}', './.storybook/**/*.{ts,tsx}'],
} satisfies Config;
