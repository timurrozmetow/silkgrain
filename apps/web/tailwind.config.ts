import silkgrainPreset from '@silkgrain/ui/tailwind-preset';
import type { Config } from 'tailwindcss';

export default {
  presets: [silkgrainPreset],
  // The design system ships as source, so its class names have to be scanned here too.
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
} satisfies Config;
