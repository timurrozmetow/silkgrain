import type { Preview } from '@storybook/react';

import { color } from '../src/tokens';

import '../src/styles.css';

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: {
      default: 'parchment',
      values: [
        { name: 'parchment', value: color.parchment },
        { name: 'surface', value: color.surface },
        { name: 'surfaceAlt', value: color.surfaceAlt },
        { name: 'greenDeep', value: color.greenDeep },
        { name: 'adminBg', value: color.adminBg },
        { name: 'white', value: color.white },
      ],
    },
    a11y: {
      // The spec targets Lighthouse Accessibility >= 95, so a violation is a build problem,
      // not a note in a panel.
      test: 'error',
    },
  },
};

export default preview;
