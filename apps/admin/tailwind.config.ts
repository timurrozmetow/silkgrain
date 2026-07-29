import silkgrainPreset from '@silkgrain/ui/tailwind-preset';
import type { Config } from 'tailwindcss';

export default {
  presets: [silkgrainPreset],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
} satisfies Config;
